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
from datetime import datetime
from flask import Flask, jsonify, request, g, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "planner.db")
FRONTEND_DIR = os.path.join(os.path.dirname(BASE_DIR), "frontend")

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
            created_at    TEXT NOT NULL
        )
        """
    )

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
    }


def goal_row_to_dict(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "target_amount": row["target_amount"],
        "target_date": row["target_date"],
    }


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
    db.execute("DELETE FROM goals WHERE id = ?", (goal_id,))
    db.commit()
    return jsonify({"ok": True})


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
    app.run(debug=True, port=5000)
