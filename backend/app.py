"""
Planner — Planejador Financeiro Pessoal
Backend Flask + SQLite

Como rodar:
    pip install -r requirements.txt
    python app.py

Depois abra http://localhost:5000 no navegador.
"""

import os
import sqlite3
import uuid
import calendar
import threading
import time
import json
from datetime import datetime
from flask import Flask, jsonify, request, g, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "planner.db")
BACKUPS_DIR = os.path.join(BASE_DIR, "data", "backups")
FRONTEND_DIR = os.path.join(os.path.dirname(BASE_DIR), "frontend")

# quantos arquivos de backup manter (os mais antigos são apagados)
MAX_BACKUPS = 30
# intervalo do backup automático em segundo plano (24h)
AUTO_BACKUP_INTERVAL_SECONDS = 24 * 60 * 60

app = Flask(__name__, static_folder=None)

# Categorias padrão criadas na primeira execução (nome, tipo)
# tipo: 'ganho', 'gasto' ou 'ambos' (aparece nos dois seletores)
CATEGORIAS_PADRAO = [
    ("Salário", "ganho"),
    ("Freelance", "ganho"),
    ("Investimentos", "ganho"),
    ("Presente", "ganho"),
    ("Outros ganhos", "ganho"),
    ("Moradia", "gasto"),
    ("Alimentação", "gasto"),
    ("Transporte", "gasto"),
    ("Saúde", "gasto"),
    ("Lazer", "gasto"),
    ("Educação", "gasto"),
    ("Assinaturas", "gasto"),
    ("Compras", "gasto"),
    ("Outros gastos", "gasto"),
]

VALID_TYPES = ("ganho", "gasto")
VALID_CATEGORY_KINDS = ("ganho", "gasto", "ambos")


# --------------------------------------------------------------------------
# Banco de dados
# --------------------------------------------------------------------------

def get_db():
    if "db" not in g:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


# --------------------------------------------------------------------------
# Backups automáticos
# --------------------------------------------------------------------------
# Estratégia: em vez de copiar os bytes do arquivo .db diretamente (arriscado
# se alguma conexão estiver com uma transação em aberto), usamos a API de
# backup nativa do sqlite3, que sabe copiar um banco em uso com segurança.

def ensure_backups_dir():
    os.makedirs(BACKUPS_DIR, exist_ok=True)


def create_backup(reason="auto"):
    """Cria uma cópia do banco atual em data/backups/, com o motivo e um
    timestamp no nome (ex: planner-manual-20260721-143000.db). Não faz nada
    se o banco ainda não existir (primeira execução, antes do init_db)."""
    if not os.path.exists(DB_PATH):
        return None
    ensure_backups_dir()
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    filename = f"planner-{reason}-{timestamp}.db"
    dest_path = os.path.join(BACKUPS_DIR, filename)

    source_conn = sqlite3.connect(DB_PATH)
    dest_conn = sqlite3.connect(dest_path)
    try:
        source_conn.backup(dest_conn)
    finally:
        source_conn.close()
        dest_conn.close()

    prune_backups()
    return filename


def prune_backups(keep=MAX_BACKUPS):
    """Mantém só os 'keep' backups mais recentes, apagando o resto."""
    ensure_backups_dir()
    files = sorted(
        (f for f in os.listdir(BACKUPS_DIR) if f.endswith(".db")),
        key=lambda f: os.path.getmtime(os.path.join(BACKUPS_DIR, f)),
        reverse=True,
    )
    for old in files[keep:]:
        try:
            os.remove(os.path.join(BACKUPS_DIR, old))
        except OSError:
            pass


def list_backup_files():
    ensure_backups_dir()
    files = []
    for f in os.listdir(BACKUPS_DIR):
        if not f.endswith(".db"):
            continue
        path = os.path.join(BACKUPS_DIR, f)
        files.append(
            {
                "filename": f,
                "created_at": datetime.utcfromtimestamp(os.path.getmtime(path)).isoformat(),
                "size_bytes": os.path.getsize(path),
            }
        )
    files.sort(key=lambda x: x["created_at"], reverse=True)
    return files


def safe_backup_path(filename):
    """Resolve um nome de backup pro caminho real dentro de BACKUPS_DIR,
    prevenindo path traversal (../../etc). Retorna None se não existir."""
    safe_name = os.path.basename(filename or "")
    path = os.path.join(BACKUPS_DIR, safe_name)
    if not safe_name or not os.path.isfile(path):
        return None
    return path


def restore_backup_file(path):
    """Sobrescreve o banco ativo com o conteúdo de um arquivo de backup.
    Sempre cria um backup de segurança do estado atual antes de restaurar,
    então mesmo uma restauração feita sem querer pode ser desfeita."""
    db = g.pop("db", None)
    if db is not None:
        db.close()

    create_backup("pre-restore")

    backup_conn = sqlite3.connect(path)
    main_conn = sqlite3.connect(DB_PATH)
    try:
        backup_conn.backup(main_conn)
    finally:
        backup_conn.close()
        main_conn.close()


def auto_backup_loop():
    """Roda em segundo plano enquanto o servidor está de pé: garante um
    backup automático ao iniciar (se o mais recente tiver mais de 24h ou não
    existir nenhum) e depois repete a cada 24h."""
    while True:
        try:
            backups = list_backup_files()
            needs_backup = True
            if backups:
                last_dt = datetime.fromisoformat(backups[0]["created_at"])
                needs_backup = (
                    datetime.utcnow() - last_dt
                ).total_seconds() >= AUTO_BACKUP_INTERVAL_SECONDS
            if needs_backup:
                create_backup("auto")
        except Exception as err:  # nunca deixa o backup automático derrubar o servidor
            print(f"[backup automático] falhou: {err}")
        time.sleep(AUTO_BACKUP_INTERVAL_SECONDS)


OFFSITE_MARKER_PATH = os.path.join(BASE_DIR, "data", "last_offsite_backup.json")


def mark_offsite_backup():
    """Registra que a pessoa acabou de baixar um backup ou exportação — usado
    pra saber há quanto tempo não existe uma cópia fora desta máquina."""
    try:
        os.makedirs(os.path.dirname(OFFSITE_MARKER_PATH), exist_ok=True)
        with open(OFFSITE_MARKER_PATH, "w", encoding="utf-8") as f:
            json.dump({"last_offsite_at": datetime.utcnow().isoformat()}, f)
    except OSError:
        pass


def get_last_offsite_backup():
    if not os.path.exists(OFFSITE_MARKER_PATH):
        return None
    try:
        with open(OFFSITE_MARKER_PATH, encoding="utf-8") as f:
            return json.load(f).get("last_offsite_at")
    except (OSError, ValueError):
        return None


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS entries (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            date        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            category    TEXT NOT NULL DEFAULT 'Outros gastos',
            type        TEXT NOT NULL,
            amount      REAL NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS categories (
            id    INTEGER PRIMARY KEY AUTOINCREMENT,
            name  TEXT NOT NULL UNIQUE,
            kind  TEXT NOT NULL DEFAULT 'ambos'
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS goals (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT NOT NULL,
            target_amount REAL NOT NULL DEFAULT 0,
            target_date   TEXT,
            current_amount REAL NOT NULL DEFAULT 0,
            created_at    TEXT NOT NULL
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS goal_contributions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            goal_id    INTEGER NOT NULL,
            date       TEXT NOT NULL,
            amount     REAL NOT NULL,
            note       TEXT,
            created_at TEXT NOT NULL
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS budgets (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            category      TEXT NOT NULL UNIQUE,
            monthly_limit REAL NOT NULL DEFAULT 0
        )
        """
    )

    # Migração: adiciona colunas de recorrência em bancos já existentes
    entry_cols = [r[1] for r in conn.execute("PRAGMA table_info(entries)").fetchall()]
    if "is_recurring" not in entry_cols:
        conn.execute("ALTER TABLE entries ADD COLUMN is_recurring INTEGER NOT NULL DEFAULT 0")
    if "recurrence_id" not in entry_cols:
        conn.execute("ALTER TABLE entries ADD COLUMN recurrence_id TEXT")

    # Migração: adiciona colunas de parcelamento em bancos já existentes
    if "installment_group_id" not in entry_cols:
        conn.execute("ALTER TABLE entries ADD COLUMN installment_group_id TEXT")
    if "installment_current" not in entry_cols:
        conn.execute("ALTER TABLE entries ADD COLUMN installment_current INTEGER")
    if "installment_total" not in entry_cols:
        conn.execute("ALTER TABLE entries ADD COLUMN installment_total INTEGER")

    # Migração: adiciona o cofrinho (current_amount) às metas já existentes
    goal_cols = [r[1] for r in conn.execute("PRAGMA table_info(goals)").fetchall()]
    if "current_amount" not in goal_cols:
        conn.execute("ALTER TABLE goals ADD COLUMN current_amount REAL NOT NULL DEFAULT 0")

    # Migração de versões antigas: 'receita' -> 'ganho', 'despesa' -> 'gasto'
    conn.execute("UPDATE entries SET type = 'ganho' WHERE type = 'receita'")
    conn.execute("UPDATE entries SET type = 'gasto' WHERE type = 'despesa'")

    # Popular categorias padrão apenas se a tabela estiver vazia
    existing = conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0]
    if existing == 0:
        conn.executemany(
            "INSERT OR IGNORE INTO categories (name, kind) VALUES (?, ?)",
            CATEGORIAS_PADRAO,
        )

    conn.commit()
    conn.close()


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def row_to_dict(row):
    return {
        "id": row["id"],
        "date": row["date"],
        "description": row["description"],
        "category": row["category"],
        "type": row["type"],
        "amount": row["amount"],
        "is_recurring": bool(row["is_recurring"]),
        "recurrence_id": row["recurrence_id"],
        "installment_group_id": row["installment_group_id"],
        "installment_current": row["installment_current"],
        "installment_total": row["installment_total"],
    }


def goal_row_to_dict(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "target_amount": row["target_amount"],
        "target_date": row["target_date"],
        "current_amount": row["current_amount"],
    }


def contribution_row_to_dict(row):
    return {
        "id": row["id"],
        "goal_id": row["goal_id"],
        "date": row["date"],
        "amount": row["amount"],
        "note": row["note"],
    }


def budget_row_to_dict(row):
    return {
        "id": row["id"],
        "category": row["category"],
        "monthly_limit": row["monthly_limit"],
    }


def add_months(date, months):
    """Soma 'months' meses a uma data, ajustando o dia se o mês de destino
    for mais curto (ex: 31/jan + 1 mês -> 28 ou 29/fev)."""
    month_index = date.month - 1 + months
    year = date.year + month_index // 12
    month = month_index % 12 + 1
    day = min(date.day, calendar.monthrange(year, month)[1])
    return date.replace(year=year, month=month, day=day)


def validate_payload(data, partial=False):
    errors = []
    if not partial or "date" in data:
        date_val = data.get("date", "")
        try:
            datetime.strptime(date_val, "%Y-%m-%d")
        except (ValueError, TypeError):
            errors.append("Data inválida. Use o formato AAAA-MM-DD.")
    if not partial or "type" in data:
        if data.get("type") not in VALID_TYPES:
            errors.append("Tipo deve ser 'ganho' ou 'gasto'.")
    if not partial or "amount" in data:
        try:
            float(data.get("amount", 0))
        except (ValueError, TypeError):
            errors.append("Valor deve ser numérico.")
    return errors


# --------------------------------------------------------------------------
# Rotas — Frontend estático
# --------------------------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(os.path.join(FRONTEND_DIR, "static"), filename)


# --------------------------------------------------------------------------
# API — Categorias
# --------------------------------------------------------------------------

@app.route("/api/categories", methods=["GET"])
def get_categories():
    db = get_db()
    kind = request.args.get("kind")  # 'ganho' ou 'gasto', opcional
    if kind in ("ganho", "gasto"):
        rows = db.execute(
            "SELECT * FROM categories WHERE kind = ? OR kind = 'ambos' ORDER BY name",
            (kind,),
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM categories ORDER BY kind, name").fetchall()
    return jsonify([{"id": r["id"], "name": r["name"], "kind": r["kind"]} for r in rows])


@app.route("/api/categories", methods=["POST"])
def create_category():
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    kind = data.get("kind", "ambos")

    if not name:
        return jsonify({"errors": ["Informe um nome para a categoria."]}), 400
    if kind not in VALID_CATEGORY_KINDS:
        return jsonify({"errors": ["Tipo de categoria inválido."]}), 400

    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO categories (name, kind) VALUES (?, ?)", (name, kind)
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"errors": ["Essa categoria já existe."]}), 400

    row = db.execute(
        "SELECT * FROM categories WHERE id = ?", (cur.lastrowid,)
    ).fetchone()
    return jsonify({"id": row["id"], "name": row["name"], "kind": row["kind"]}), 201


@app.route("/api/categories/<int:category_id>", methods=["DELETE"])
def delete_category(category_id):
    db = get_db()
    existing = db.execute(
        "SELECT id FROM categories WHERE id = ?", (category_id,)
    ).fetchone()
    if existing is None:
        return jsonify({"error": "Categoria não encontrada."}), 404
    db.execute("DELETE FROM categories WHERE id = ?", (category_id,))
    db.commit()
    return jsonify({"ok": True})


# --------------------------------------------------------------------------
# API — Lançamentos (entries)
# --------------------------------------------------------------------------

@app.route("/api/entries", methods=["GET"])
def list_entries():
    db = get_db()
    month = request.args.get("month")  # formato AAAA-MM
    if month:
        rows = db.execute(
            "SELECT * FROM entries WHERE date LIKE ? ORDER BY date ASC, id ASC",
            (f"{month}%",),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM entries ORDER BY date ASC, id ASC"
        ).fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.route("/api/entries", methods=["POST"])
def create_entry():
    data = request.get_json(force=True) or {}
    errors = validate_payload(data)
    if errors:
        return jsonify({"errors": errors}), 400

    db = get_db()
    cur = db.execute(
        """
        INSERT INTO entries (date, description, category, type, amount, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            data["date"],
            data.get("description", ""),
            data.get("category", "Outros gastos"),
            data["type"],
            float(data.get("amount", 0)),
            datetime.utcnow().isoformat(),
        ),
    )
    db.commit()
    new_row = db.execute(
        "SELECT * FROM entries WHERE id = ?", (cur.lastrowid,)
    ).fetchone()
    return jsonify(row_to_dict(new_row)), 201


@app.route("/api/entries/<int:entry_id>", methods=["PUT"])
def update_entry(entry_id):
    data = request.get_json(force=True) or {}
    errors = validate_payload(data, partial=True)
    if errors:
        return jsonify({"errors": errors}), 400

    db = get_db()
    existing = db.execute(
        "SELECT * FROM entries WHERE id = ?", (entry_id,)
    ).fetchone()
    if existing is None:
        return jsonify({"error": "Lançamento não encontrado."}), 404

    merged = {
        "date": data.get("date", existing["date"]),
        "description": data.get("description", existing["description"]),
        "category": data.get("category", existing["category"]),
        "type": data.get("type", existing["type"]),
        "amount": float(data.get("amount", existing["amount"])),
    }

    db.execute(
        """
        UPDATE entries
        SET date = ?, description = ?, category = ?, type = ?, amount = ?
        WHERE id = ?
        """,
        (
            merged["date"],
            merged["description"],
            merged["category"],
            merged["type"],
            merged["amount"],
            entry_id,
        ),
    )
    db.commit()
    row = db.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
    return jsonify(row_to_dict(row))


@app.route("/api/entries/<int:entry_id>", methods=["DELETE"])
def delete_entry(entry_id):
    db = get_db()
    existing = db.execute(
        "SELECT id FROM entries WHERE id = ?", (entry_id,)
    ).fetchone()
    if existing is None:
        return jsonify({"error": "Lançamento não encontrado."}), 404
    db.execute("DELETE FROM entries WHERE id = ?", (entry_id,))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/entries/<int:entry_id>/series", methods=["DELETE"])
def delete_entry_series(entry_id):
    """Apaga um grupo inteiro de lançamentos ligados (recorrência ou
    parcelamento) de uma vez. `scope=future` (padrão) apaga esta ocorrência e
    as seguintes, mantendo as anteriores; `scope=all` apaga o grupo todo."""
    db = get_db()
    entry = db.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
    if entry is None:
        return jsonify({"error": "Lançamento não encontrado."}), 404

    if entry["recurrence_id"]:
        group_field, group_value = "recurrence_id", entry["recurrence_id"]
    elif entry["installment_group_id"]:
        group_field, group_value = "installment_group_id", entry["installment_group_id"]
    else:
        return jsonify(
            {"errors": ["Esse lançamento não faz parte de uma recorrência ou parcelamento."]}
        ), 400

    scope = request.args.get("scope", "future")
    if scope == "all":
        deleted = db.execute(
            f"DELETE FROM entries WHERE {group_field} = ?", (group_value,)
        )
    else:
        deleted = db.execute(
            f"DELETE FROM entries WHERE {group_field} = ? AND date >= ?",
            (group_value, entry["date"]),
        )
    db.commit()
    return jsonify({"ok": True, "deleted": deleted.rowcount})


@app.route("/api/entries/<int:entry_id>/repeat", methods=["POST"])
def repeat_entry(entry_id):
    db = get_db()
    entry = db.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
    if entry is None:
        return jsonify({"error": "Lançamento não encontrado."}), 404

    data = request.get_json(silent=True) or {}
    try:
        months_ahead = int(data.get("months", 11))
    except (ValueError, TypeError):
        months_ahead = 11
    months_ahead = max(1, min(months_ahead, 36))

    recurrence_id = entry["recurrence_id"] or str(uuid.uuid4())
    if not entry["is_recurring"] or not entry["recurrence_id"]:
        db.execute(
            "UPDATE entries SET is_recurring = 1, recurrence_id = ? WHERE id = ?",
            (recurrence_id, entry_id),
        )

    base_date = datetime.strptime(entry["date"], "%Y-%m-%d")
    created = 0
    for i in range(1, months_ahead + 1):
        next_date = add_months(base_date, i).strftime("%Y-%m-%d")
        exists = db.execute(
            "SELECT id FROM entries WHERE recurrence_id = ? AND date = ?",
            (recurrence_id, next_date),
        ).fetchone()
        if exists:
            continue
        db.execute(
            """
            INSERT INTO entries
                (date, description, category, type, amount, created_at, is_recurring, recurrence_id)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?)
            """,
            (
                next_date,
                entry["description"],
                entry["category"],
                entry["type"],
                entry["amount"],
                datetime.utcnow().isoformat(),
                recurrence_id,
            ),
        )
        created += 1

    db.commit()
    return jsonify({"ok": True, "created": created})


@app.route("/api/entries/<int:entry_id>/installments", methods=["POST"])
def installment_entry(entry_id):
    """Divide o valor do lançamento em N parcelas mensais iguais (com o
    resto de arredondamento absorvido pela última parcela). A linha atual
    vira a parcela 1/N e as demais N-1 são criadas nos meses seguintes,
    todas ligadas por um installment_group_id."""
    db = get_db()
    entry = db.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
    if entry is None:
        return jsonify({"error": "Lançamento não encontrado."}), 404

    if entry["installment_total"]:
        return jsonify({"errors": ["Esse lançamento já faz parte de um parcelamento."]}), 400

    if entry["type"] != "gasto":
        return jsonify({"errors": ["Só é possível parcelar lançamentos do tipo Gasto."]}), 400

    data = request.get_json(silent=True) or {}
    try:
        total_installments = int(data.get("installments", 2))
    except (ValueError, TypeError):
        return jsonify({"errors": ["Número de parcelas inválido."]}), 400
    total_installments = max(2, min(total_installments, 60))

    total_amount = data.get("total_amount")
    try:
        total_amount = float(total_amount) if total_amount is not None else float(entry["amount"])
    except (ValueError, TypeError):
        return jsonify({"errors": ["Valor total inválido."]}), 400
    if total_amount <= 0:
        return jsonify({"errors": ["O valor total deve ser maior que zero."]}), 400

    group_id = str(uuid.uuid4())
    per_installment = round(total_amount / total_installments, 2)
    # a última parcela absorve o resto do arredondamento
    last_installment = round(total_amount - per_installment * (total_installments - 1), 2)

    db.execute(
        """
        UPDATE entries
        SET amount = ?, installment_group_id = ?, installment_current = 1, installment_total = ?
        WHERE id = ?
        """,
        (per_installment, group_id, total_installments, entry_id),
    )

    base_date = datetime.strptime(entry["date"], "%Y-%m-%d")
    for i in range(2, total_installments + 1):
        amount = last_installment if i == total_installments else per_installment
        next_date = add_months(base_date, i - 1).strftime("%Y-%m-%d")
        db.execute(
            """
            INSERT INTO entries
                (date, description, category, type, amount, created_at,
                 installment_group_id, installment_current, installment_total)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                next_date,
                entry["description"],
                entry["category"],
                entry["type"],
                amount,
                datetime.utcnow().isoformat(),
                group_id,
                i,
                total_installments,
            ),
        )

    db.commit()
    rows = db.execute(
        "SELECT * FROM entries WHERE installment_group_id = ? ORDER BY installment_current ASC",
        (group_id,),
    ).fetchall()
    return jsonify({"ok": True, "entries": [row_to_dict(r) for r in rows]}), 201


# --------------------------------------------------------------------------
# API — Metas futuras (goals)
# --------------------------------------------------------------------------

@app.route("/api/goals", methods=["GET"])
def list_goals():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM goals ORDER BY (target_date IS NULL), target_date ASC, id ASC"
    ).fetchall()
    return jsonify([goal_row_to_dict(r) for r in rows])


def validate_goal_payload(data, partial=False):
    errors = []
    if not partial or "name" in data:
        if not (data.get("name") or "").strip():
            errors.append("Informe um nome para a meta.")
    if not partial or "target_amount" in data:
        try:
            if float(data.get("target_amount", 0)) <= 0:
                errors.append("O valor da meta deve ser maior que zero.")
        except (ValueError, TypeError):
            errors.append("Valor da meta deve ser numérico.")
    target_date = data.get("target_date")
    if target_date:
        try:
            datetime.strptime(target_date, "%Y-%m-%d")
        except ValueError:
            errors.append("Data da meta inválida. Use o formato AAAA-MM-DD.")
    return errors


@app.route("/api/goals", methods=["POST"])
def create_goal():
    data = request.get_json(force=True) or {}
    errors = validate_goal_payload(data)
    if errors:
        return jsonify({"errors": errors}), 400

    db = get_db()
    cur = db.execute(
        "INSERT INTO goals (name, target_amount, target_date, created_at) VALUES (?, ?, ?, ?)",
        (
            data["name"].strip(),
            float(data["target_amount"]),
            data.get("target_date") or None,
            datetime.utcnow().isoformat(),
        ),
    )
    db.commit()
    row = db.execute("SELECT * FROM goals WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(goal_row_to_dict(row)), 201


@app.route("/api/goals/<int:goal_id>", methods=["PUT"])
def update_goal(goal_id):
    data = request.get_json(force=True) or {}
    errors = validate_goal_payload(data, partial=True)
    if errors:
        return jsonify({"errors": errors}), 400

    db = get_db()
    existing = db.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone()
    if existing is None:
        return jsonify({"error": "Meta não encontrada."}), 404

    merged = {
        "name": (data.get("name") or existing["name"]).strip(),
        "target_amount": float(data.get("target_amount", existing["target_amount"])),
        "target_date": data.get("target_date", existing["target_date"]) or None,
    }

    db.execute(
        "UPDATE goals SET name = ?, target_amount = ?, target_date = ? WHERE id = ?",
        (merged["name"], merged["target_amount"], merged["target_date"], goal_id),
    )
    db.commit()
    row = db.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone()
    return jsonify(goal_row_to_dict(row))


@app.route("/api/goals/<int:goal_id>", methods=["DELETE"])
def delete_goal(goal_id):
    db = get_db()
    existing = db.execute("SELECT id FROM goals WHERE id = ?", (goal_id,)).fetchone()
    if existing is None:
        return jsonify({"error": "Meta não encontrada."}), 404
    db.execute("DELETE FROM goal_contributions WHERE goal_id = ?", (goal_id,))
    db.execute("DELETE FROM goals WHERE id = ?", (goal_id,))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/goals/<int:goal_id>/contributions", methods=["GET"])
def list_contributions(goal_id):
    db = get_db()
    goal = db.execute("SELECT id FROM goals WHERE id = ?", (goal_id,)).fetchone()
    if goal is None:
        return jsonify({"error": "Meta não encontrada."}), 404
    rows = db.execute(
        "SELECT * FROM goal_contributions WHERE goal_id = ? ORDER BY date DESC, id DESC",
        (goal_id,),
    ).fetchall()
    return jsonify([contribution_row_to_dict(r) for r in rows])


@app.route("/api/goals/<int:goal_id>/contributions", methods=["POST"])
def create_contribution(goal_id):
    """Registra uma contribuição manual (depósito ou retirada) no cofrinho
    da meta. amount positivo = depósito, negativo = retirada. Uma retirada
    não pode deixar o cofrinho com saldo negativo."""
    db = get_db()
    goal = db.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone()
    if goal is None:
        return jsonify({"error": "Meta não encontrada."}), 404

    data = request.get_json(force=True) or {}
    try:
        amount = float(data.get("amount", 0))
    except (ValueError, TypeError):
        return jsonify({"errors": ["Valor inválido."]}), 400
    if amount == 0:
        return jsonify({"errors": ["O valor da contribuição não pode ser zero."]}), 400

    new_total = round(goal["current_amount"] + amount, 2)
    if new_total < 0:
        return jsonify({"errors": ["Não é possível retirar mais do que o valor guardado no cofrinho."]}), 400

    date = data.get("date") or datetime.utcnow().strftime("%Y-%m-%d")
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        return jsonify({"errors": ["Data inválida. Use o formato AAAA-MM-DD."]}), 400

    note = (data.get("note") or "").strip() or None

    db.execute(
        "INSERT INTO goal_contributions (goal_id, date, amount, note, created_at) VALUES (?, ?, ?, ?, ?)",
        (goal_id, date, amount, note, datetime.utcnow().isoformat()),
    )
    db.execute("UPDATE goals SET current_amount = ? WHERE id = ?", (new_total, goal_id))
    db.commit()

    goal_row = db.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone()
    contributions = db.execute(
        "SELECT * FROM goal_contributions WHERE goal_id = ? ORDER BY date DESC, id DESC",
        (goal_id,),
    ).fetchall()
    return jsonify({
        "goal": goal_row_to_dict(goal_row),
        "contributions": [contribution_row_to_dict(r) for r in contributions],
    }), 201


@app.route("/api/goals/<int:goal_id>/contributions/<int:contribution_id>", methods=["DELETE"])
def delete_contribution(goal_id, contribution_id):
    db = get_db()
    goal = db.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone()
    if goal is None:
        return jsonify({"error": "Meta não encontrada."}), 404

    contribution = db.execute(
        "SELECT * FROM goal_contributions WHERE id = ? AND goal_id = ?",
        (contribution_id, goal_id),
    ).fetchone()
    if contribution is None:
        return jsonify({"error": "Contribuição não encontrada."}), 404

    new_total = round(goal["current_amount"] - contribution["amount"], 2)
    if new_total < 0:
        new_total = 0  # segurança contra inconsistências de arredondamento

    db.execute("DELETE FROM goal_contributions WHERE id = ?", (contribution_id,))
    db.execute("UPDATE goals SET current_amount = ? WHERE id = ?", (new_total, goal_id))
    db.commit()

    goal_row = db.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone()
    contributions = db.execute(
        "SELECT * FROM goal_contributions WHERE goal_id = ? ORDER BY date DESC, id DESC",
        (goal_id,),
    ).fetchall()
    return jsonify({
        "goal": goal_row_to_dict(goal_row),
        "contributions": [contribution_row_to_dict(r) for r in contributions],
    })


# --------------------------------------------------------------------------
# API — Orçamentos por categoria (budgets)
# --------------------------------------------------------------------------

@app.route("/api/budgets", methods=["GET"])
def list_budgets():
    db = get_db()
    rows = db.execute("SELECT * FROM budgets ORDER BY category ASC").fetchall()
    return jsonify([budget_row_to_dict(r) for r in rows])


@app.route("/api/budgets", methods=["POST"])
def create_or_update_budget():
    data = request.get_json(force=True) or {}
    category = (data.get("category") or "").strip()
    if not category:
        return jsonify({"errors": ["Selecione uma categoria."]}), 400
    try:
        monthly_limit = float(data.get("monthly_limit", 0))
        if monthly_limit <= 0:
            return jsonify({"errors": ["O orçamento deve ser maior que zero."]}), 400
    except (ValueError, TypeError):
        return jsonify({"errors": ["Valor do orçamento deve ser numérico."]}), 400

    db = get_db()
    existing = db.execute("SELECT id FROM budgets WHERE category = ?", (category,)).fetchone()
    if existing:
        db.execute(
            "UPDATE budgets SET monthly_limit = ? WHERE id = ?",
            (monthly_limit, existing["id"]),
        )
        budget_id = existing["id"]
    else:
        cur = db.execute(
            "INSERT INTO budgets (category, monthly_limit) VALUES (?, ?)",
            (category, monthly_limit),
        )
        budget_id = cur.lastrowid
    db.commit()

    row = db.execute("SELECT * FROM budgets WHERE id = ?", (budget_id,)).fetchone()
    return jsonify(budget_row_to_dict(row)), 201


@app.route("/api/budgets/<int:budget_id>", methods=["DELETE"])
def delete_budget(budget_id):
    db = get_db()
    existing = db.execute("SELECT id FROM budgets WHERE id = ?", (budget_id,)).fetchone()
    if existing is None:
        return jsonify({"error": "Orçamento não encontrado."}), 404
    db.execute("DELETE FROM budgets WHERE id = ?", (budget_id,))
    db.commit()
    return jsonify({"ok": True})


# --------------------------------------------------------------------------
# API — Backups
# --------------------------------------------------------------------------

@app.route("/api/backups", methods=["GET"])
def api_list_backups():
    return jsonify(list_backup_files())


@app.route("/api/backups", methods=["POST"])
def api_create_backup():
    filename = create_backup("manual")
    if filename is None:
        return jsonify({"error": "O banco de dados ainda não existe."}), 400
    return jsonify({"ok": True, "filename": filename}), 201


@app.route("/api/backups/<filename>/download")
def api_download_backup(filename):
    path = safe_backup_path(filename)
    if path is None:
        return jsonify({"error": "Backup não encontrado."}), 404
    mark_offsite_backup()
    return send_from_directory(BACKUPS_DIR, os.path.basename(path), as_attachment=True)


@app.route("/api/backups/<filename>/restore", methods=["POST"])
def api_restore_backup(filename):
    path = safe_backup_path(filename)
    if path is None:
        return jsonify({"error": "Backup não encontrado."}), 404
    try:
        restore_backup_file(path)
    except Exception as err:
        return jsonify({"error": f"Falha ao restaurar backup: {err}"}), 500
    return jsonify({"ok": True})


@app.route("/api/backups/<filename>", methods=["DELETE"])
def api_delete_backup(filename):
    path = safe_backup_path(filename)
    if path is None:
        return jsonify({"error": "Backup não encontrado."}), 404
    os.remove(path)
    return jsonify({"ok": True})

@app.route("/api/backups/status")
def api_backups_status():
    last_offsite_at = get_last_offsite_backup()
    days_since = None
    if last_offsite_at:
        try:
            delta = datetime.utcnow() - datetime.fromisoformat(last_offsite_at)
            days_since = delta.total_seconds() / 86400
        except ValueError:
            days_since = None
    return jsonify({"last_offsite_at": last_offsite_at, "days_since": days_since})


# --------------------------------------------------------------------------
# API — Exportar / importar todos os dados
# --------------------------------------------------------------------------
# O export inclui TODAS as colunas (inclusive id e created_at) pra que um
# import recomponha exatamente o mesmo estado, preservando as ligações entre
# tabelas (ex: goal_contributions.goal_id continua apontando pra meta certa).

IMPORT_TABLES = {
    "entries": [
        "id", "date", "description", "category", "type", "amount", "created_at",
        "is_recurring", "recurrence_id",
        "installment_group_id", "installment_current", "installment_total",
    ],
    "categories": ["id", "name", "kind"],
    "goals": ["id", "name", "target_amount", "target_date", "current_amount", "created_at"],
    "goal_contributions": ["id", "goal_id", "date", "amount", "note", "created_at"],
    "budgets": ["id", "category", "monthly_limit"],
}


@app.route("/api/export")
def api_export():
    db = get_db()
    payload = {
        "app": "planner",
        "version": 1,
        "exported_at": datetime.utcnow().isoformat(),
    }
    for table in IMPORT_TABLES:
        rows = db.execute(f"SELECT * FROM {table} ORDER BY id ASC").fetchall()
        payload[table] = [dict(r) for r in rows]

    response = jsonify(payload)
    filename = f"planner-export-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.json"
    response.headers["Content-Disposition"] = f"attachment; filename={filename}"
    mark_offsite_backup()
    return response


@app.route("/api/import", methods=["POST"])
def api_import():
    payload = request.get_json(force=True, silent=True)
    if not isinstance(payload, dict):
        return jsonify({"errors": ["Arquivo inválido. Envie um JSON exportado pelo próprio Planner."]}), 400

    missing = [key for key in IMPORT_TABLES if key not in payload]
    if missing:
        return jsonify(
            {"errors": [f"Arquivo incompleto — faltam os dados de: {', '.join(missing)}."]}
        ), 400

    for key in IMPORT_TABLES:
        if not isinstance(payload[key], list):
            return jsonify({"errors": [f"O campo '{key}' deveria ser uma lista."]}), 400

    # backup de segurança: se algo der errado ou o arquivo importado não era
    # o que a pessoa esperava, dá pra restaurar o estado anterior
    create_backup("pre-import")

    db = get_db()
    try:
        db.execute("DELETE FROM goal_contributions")
        db.execute("DELETE FROM budgets")
        db.execute("DELETE FROM goals")
        db.execute("DELETE FROM categories")
        db.execute("DELETE FROM entries")

        for table, columns in IMPORT_TABLES.items():
            column_list = ", ".join(columns)
            placeholders = ", ".join("?" for _ in columns)
            for row in payload[table]:
                values = [row.get(col) for col in columns]
                db.execute(
                    f"INSERT INTO {table} ({column_list}) VALUES ({placeholders})",
                    values,
                )
        db.commit()
    except Exception as err:
        db.rollback()
        return jsonify(
            {
                "errors": [
                    f"Falha ao importar ({err}). Nenhuma alteração foi salva — "
                    "o backup de segurança criado antes da tentativa está "
                    "disponível na lista de backups, caso precise."
                ]
            }
        ), 400

    counts = {key: len(payload[key]) for key in IMPORT_TABLES}
    return jsonify({"ok": True, "counts": counts})


# --------------------------------------------------------------------------
# API — Resumo / dados para os gráficos
# --------------------------------------------------------------------------

@app.route("/api/summary")
def summary():
    db = get_db()
    rows = db.execute("SELECT * FROM entries ORDER BY date ASC").fetchall()

    total_ganhos = sum(r["amount"] for r in rows if r["type"] == "ganho")
    total_gastos = sum(r["amount"] for r in rows if r["type"] == "gasto")
    saldo = total_ganhos - total_gastos

    # Agregação mensal
    monthly = {}
    for r in rows:
        month_key = r["date"][:7]  # AAAA-MM
        m = monthly.setdefault(month_key, {"ganhos": 0.0, "gastos": 0.0})
        if r["type"] == "ganho":
            m["ganhos"] += r["amount"]
        else:
            m["gastos"] += r["amount"]

    months_sorted = sorted(monthly.keys())
    cumulative = 0.0
    monthly_series = []
    for m in months_sorted:
        ganhos = round(monthly[m]["ganhos"], 2)
        gastos = round(monthly[m]["gastos"], 2)
        economia = round(ganhos - gastos, 2)
        cumulative += economia
        monthly_series.append(
            {
                "month": m,
                "ganhos": ganhos,
                "gastos": gastos,
                "economia": economia,
                "saldo_acumulado": round(cumulative, 2),
            }
        )

    # Gastos por categoria (para o gráfico de rosca)
    by_category = {}
    for r in rows:
        if r["type"] == "gasto":
            by_category[r["category"]] = by_category.get(r["category"], 0.0) + r["amount"]
    category_series = sorted(
        [{"category": k, "amount": round(v, 2)} for k, v in by_category.items()],
        key=lambda x: -x["amount"],
    )

    return jsonify(
        {
            "total_ganhos": round(total_ganhos, 2),
            "total_gastos": round(total_gastos, 2),
            "saldo": round(saldo, 2),
            "monthly": monthly_series,
            "by_category": category_series,
        }
    )


if __name__ == "__main__":
    init_db()
    # em modo debug o Flask sobe um processo "vigia" além do processo que
    # realmente atende requisições; só inicia a thread de backup nesse
    # segundo, pra não rodar tudo em dobro
    if not app.debug or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        threading.Thread(target=auto_backup_loop, daemon=True).start()
    app.run(debug=True, port=5000)
