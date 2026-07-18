# Planner — Planejador Financeiro Pessoal

Aplicação fullstack para controlar ganhos e gastos numa tabela estilo planilha,
com categorias personalizáveis e gráficos de evolução mensal.

- **Backend:** Python (Flask + SQLite, sem dependências pesadas)
- **Frontend:** HTML + CSS + JavaScript puro (sem build step), gráficos com Chart.js

## Estrutura

```
planner/
├── backend/
│   ├── app.py            # servidor Flask + API REST
│   ├── requirements.txt
│   └── data/              # criado automaticamente (planner.db)
└── frontend/
    ├── index.html
    └── static/
        ├── style.css
        └── script.js
```

## Como rodar

1. Instale as dependências (recomendo um ambiente virtual):

   ```bash
   cd planner/backend
   python3 -m venv venv
   source venv/bin/activate          # Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. Rode o servidor:

   ```bash
   python app.py
   ```

3. Abra **http://localhost:5000** no navegador.

O Flask já serve o front-end (`frontend/index.html`) e a API na mesma porta —
não precisa rodar dois servidores.

Os dados ficam salvos em `backend/data/planner.db` (SQLite). Esse arquivo é
criado sozinho na primeira execução; para "zerar" o app, basta apagá-lo.

## Como usar

- **Lançamentos:** clique em **+ Novo lançamento** para abrir uma nova linha
  na tabela. Preencha data, descrição, categoria, tipo (Ganho/Gasto) e valor.
  Cada alteração é salva automaticamente ao sair do campo.
- **Categorias:** clique em **Gerenciar categorias** para abrir o painel.
  Lá você adiciona novas categorias de ganho ou de gasto (ex: "Pets",
  "Viagens", "Bônus") e remove as que não usa. As categorias aparecem
  automaticamente no seletor de cada linha da tabela, filtradas pelo tipo
  (Ganho ou Gasto) escolhido naquela linha.
- A coluna **Saldo** mostra o saldo acumulado até aquela linha, calculado em
  ordem cronológica.
- Os gráficos e os totais no topo (ganhos, gastos, taxa de economia, saldo
  acumulado) se atualizam sozinhos a cada mudança.

## API REST (caso queira integrar com outra coisa)

| Método | Rota                       | Descrição                              |
|--------|-----------------------------|------------------------------------------|
| GET    | `/api/entries`               | lista lançamentos (`?month=2026-07`)     |
| POST   | `/api/entries`               | cria lançamento                          |
| PUT    | `/api/entries/<id>`          | atualiza lançamento                      |
| DELETE | `/api/entries/<id>`          | remove lançamento                        |
| GET    | `/api/summary`               | totais, série mensal e por categoria     |
| GET    | `/api/categories`             | lista categorias (`?kind=ganho\|gasto`)  |
| POST   | `/api/categories`             | cria categoria `{name, kind}`            |
| DELETE | `/api/categories/<id>`        | remove categoria                         |

`kind` de uma categoria pode ser `"ganho"`, `"gasto"` ou `"ambos"` (aparece
nos dois seletores).

## Personalização rápida

- **Categorias padrão:** edite a lista `CATEGORIAS_PADRAO` em `backend/app.py`
  (só é usada na primeira execução, para popular o banco vazio).
- **Cores/tipografia:** tudo centralizado nas variáveis CSS no topo de
  `frontend/static/style.css` (`:root { ... }`) — paleta neutra em tons de
  cinza-carvão, salvia (ganho), argila (gasto) e areia (destaque).
- **Trocar de banco:** como o app usa SQL simples via `sqlite3`, migrar para
  Postgres/MySQL exigiria trocar a camada de conexão em `app.py` — o resto
  do código (rotas, validação) continua igual.
