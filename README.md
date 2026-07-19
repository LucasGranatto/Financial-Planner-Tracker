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
- **Metas futuras:** clique em **+ Nova meta** para definir um objetivo
  (nome, valor alvo e, opcionalmente, uma data). Cada meta vira um card com
  uma barra de progresso calculada a partir do seu saldo acumulado atual —
  quando o saldo alcança o valor alvo, a barra fica verde e mostra "Meta
  atingida!". É um cálculo simples (saldo atual vs. valor alvo), não um
  cofrinho separado por meta.
- **Abas de mês:** acima da tabela ficam as abas — uma por mês com
  lançamentos, no estilo das guias de um fichário — sempre mostrando um mês
  por vez (a mais recente, ou o mês atual se já tiver lançamentos). Clique
  numa aba para trocar de mês; o pontinho ao lado do nome (no formato
  MM/AA, ex: "07/26") indica se aquele mês fechou no positivo (verde) ou no
  negativo (vermelho). O saldo de cada
  linha continua calculado sobre o histórico completo, então os valores não
  mudam ao trocar de aba — só a visualização.
- **Categorias:** clique em **Gerenciar categorias** para abrir o painel.
  Lá você adiciona novas categorias de ganho ou de gasto (ex: "Pets",
  "Viagens", "Bônus") e remove as que não usa. As categorias aparecem
  automaticamente no seletor de cada linha da tabela, filtradas pelo tipo
  (Ganho ou Gasto) escolhido naquela linha.
- **Orçamentos por categoria:** clique em **+ Definir orçamento**, escolha
  uma categoria de gasto e um limite mensal. Cada orçamento vira um card com
  barra de progresso comparando o quanto já foi gasto naquela categoria
  **no mês selecionado nas abas** contra o limite — fica amarela perto do
  limite (80%+) e vermelha se estourar.
- **Lançamentos recorrentes:** clique no ícone 🔁 de qualquer linha da
  tabela para repeti-la automaticamente pelos próximos 12 meses (mesma
  descrição, categoria, tipo e valor, uma ocorrência por mês). Cada
  ocorrência gerada é uma linha independente — editar ou apagar uma não
  afeta as outras. Clicar de novo preenche só os meses que ainda não têm
  essa recorrência, sem duplicar.
- **Busca:** o campo acima da tabela filtra as linhas do mês ativo por
  descrição ou categoria, em tempo real.
- **Comparação com o mês anterior:** ao lado da busca, uma faixa mostra
  como o mês selecionado está indo (ganhos, gastos e economia) comparado ao
  mês anterior com lançamentos — verde quando é uma boa notícia (ganhos ou
  economia subindo, gastos caindo), vermelho quando não é.
- A coluna **Saldo** mostra o saldo acumulado até aquela linha, calculado em
  ordem cronológica.
- Os gráficos e os totais no topo (ganhos, gastos, taxa de economia, saldo
  acumulado) se atualizam sozinhos a cada mudança. O gráfico de evolução
  mensal mostra ganhos subindo e gastos descendo a partir do zero, com o
  saldo acumulado sobreposto como uma linha.

## API REST (caso queira integrar com outra coisa)

| Método | Rota                       | Descrição                              |
|--------|-----------------------------|------------------------------------------|
| GET    | `/api/entries`               | lista lançamentos (`?month=2026-07`)     |
| POST   | `/api/entries`               | cria lançamento                          |
| PUT    | `/api/entries/<id>`          | atualiza lançamento                      |
| DELETE | `/api/entries/<id>`          | remove lançamento                        |
| POST   | `/api/entries/<id>/repeat`    | gera as próximas N ocorrências mensais (`{months: 11}`, padrão 11) |
| GET    | `/api/summary`               | totais, série mensal e por categoria     |
| GET    | `/api/categories`             | lista categorias (`?kind=ganho\|gasto`)  |
| POST   | `/api/categories`             | cria categoria `{name, kind}`            |
| DELETE | `/api/categories/<id>`        | remove categoria                         |
| GET    | `/api/goals`                  | lista metas futuras                      |
| POST   | `/api/goals`                  | cria meta `{name, target_amount, target_date?}` |
| PUT    | `/api/goals/<id>`             | atualiza meta                            |
| DELETE | `/api/goals/<id>`             | remove meta                              |
| GET    | `/api/budgets`                | lista orçamentos por categoria           |
| POST   | `/api/budgets`                | cria ou atualiza orçamento `{category, monthly_limit}` (upsert por categoria) |
| DELETE | `/api/budgets/<id>`           | remove orçamento                         |

`kind` de uma categoria pode ser `"ganho"`, `"gasto"` ou `"ambos"` (aparece
nos dois seletores).

## Personalização rápida

- **Categorias padrão:** edite a lista `CATEGORIAS_PADRAO` em `backend/app.py`
  (só é usada na primeira execução, para popular o banco vazio).
- **Cores/tipografia:** tudo centralizado nas variáveis CSS no topo de
  `frontend/static/style.css` (`:root { ... }`) — tema escuro neutro, texto
  quase branco, e cores de destaque bem saturadas: jade (ganho e metas
  atingidas), carmim (gasto), cobalto (marca/saldo/progresso de metas) e
  violeta (taxa de economia). Tipografia em Newsreader (display, itálico) +
  Work Sans (corpo) + IBM Plex Mono (números e datas).
- **Cabeçalho:** faixa cheia (edge-to-edge) com textura de pauta e a data do
  dia; o nome "Planner" é o próprio elemento de marca — sem logotipo em
  caixa nem indicador de saldo — separado do `.page`, então dá pra
  estilizar sem afetar o resto do layout.
- **Largura:** o layout usa a variável `--content-max` (1360px) tanto no
  cabeçalho quanto no `.page`; para uma versão mais larga ou mais estreita,
  basta ajustar esse valor num único lugar.
- **Trocar de banco:** como o app usa SQL simples via `sqlite3`, migrar para
  Postgres/MySQL exigiria trocar a camada de conexão em `app.py` — o resto
  do código (rotas, validação) continua igual.
