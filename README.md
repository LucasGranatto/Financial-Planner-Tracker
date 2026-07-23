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
│   └── data/              # criado automaticamente
│       ├── planner.db
│       ├── last_offsite_backup.json   # marca a última vez que algo foi baixado
│       └── backups/                   # cópias automáticas e manuais do banco
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
criado sozinho na primeira execução; para "zerar" o app, apague-o (e, se
quiser, `backend/data/backups/` também — veja a seção **Segurança dos
dados** abaixo antes de fazer isso, já que apagar sem exportar antes perde
o histórico de verdade).

## Como usar

- **Lançamentos:** clique em **+ Novo lançamento** para abrir uma nova linha
  na tabela. Preencha data, descrição, categoria, tipo (Ganho/Gasto) e valor.
  Cada alteração é salva automaticamente ao sair do campo.
- **Metas futuras:** clique em **+ Nova meta** para definir um objetivo
  (nome, valor alvo e, opcionalmente, uma data). Cada meta tem seu próprio
  **cofrinho**, totalmente separado do saldo geral do planner: o progresso
  só sobe quando você registra uma contribuição manual — "+ Guardar" para
  depositar, "− Retirar" para sacar (não é possível retirar mais do que já
  está guardado). Quando o valor guardado alcança a meta, a barra fica
  verde e mostra "Meta atingida!". O link **Ver histórico de
  contribuições** no rodapé de cada card mostra todos os depósitos/saques
  registrados, com data e um botão para remover algum lançado por engano
  (o total do cofrinho é recalculado automaticamente).
- **Abas de mês:** acima da tabela ficam as abas — uma por mês com
  lançamentos, no estilo das guias de um fichário — sempre mostrando um mês
  por vez (a mais recente, ou o mês atual se já tiver lançamentos). Clique
  numa aba para trocar de mês; o pontinho ao lado do nome (no formato
  MM/AA, ex: "07/26") indica se aquele mês fechou no positivo (verde) ou no
  negativo (vermelho). O saldo de cada
  linha continua calculado sobre o histórico completo, então os valores não
  mudam ao trocar de aba — só a visualização. Quando há lançamentos em mais
  de um ano, uma linha de abas de **ano** aparece acima das abas de mês pra
  filtrar quais meses aparecem.
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
  afeta as outras. Clicar de novo numa linha que já repete oferece duas
  opções: **gerar os meses que ainda faltam** (preenche só o que não existe
  ainda, sem duplicar) ou **parar a recorrência** (apaga essa ocorrência e
  todas as futuras de uma vez, mantendo as que já venceram no histórico).
- **Parcelamentos:** clique no ícone 💳 (só aparece em lançamentos do tipo
  Gasto) pra dividir o valor em parcelas mensais iguais — a linha atual vira
  a parcela 1 e as demais são criadas nos meses seguintes, todas marcadas
  com o número da parcela (ex: "2/6"). Clicar de novo numa parcela já
  existente oferece **cancelar as parcelas futuras** dessa compra (mantém
  as que já venceram).
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
  saldo acumulado sobreposto como uma linha. Quando há dados em mais de um
  ano, um segundo gráfico de **comparação anual** (com tabela de ganhos,
  gastos e saldo por ano) aparece logo abaixo.
- **Excluir lançamentos, metas, orçamentos, categorias e contribuições** não
  pede confirmação num popup — o item some da tela na hora e um aviso com
  **"Desfazer"** fica visível por alguns segundos no rodapé da tela. Só
  depois desse tempo a exclusão é enviada de fato pro servidor; clicar em
  "Desfazer" só restaura o item, sem nunca ter apagado nada.

## Segurança dos dados

- **Backup automático:** o servidor guarda uma cópia do banco em
  `backend/data/backups/` assim que inicia (se a última tiver mais de 24h)
  e depois a cada 24h enquanto ficar rodando, além de sempre antes de uma
  importação ou restauração. Só os 30 backups mais recentes são mantidos —
  os mais antigos são apagados automaticamente.
- **Exportar/importar tudo:** na seção "Segurança dos dados" da página,
  **Exportar tudo (JSON)** baixa um arquivo com todos os lançamentos,
  categorias, metas, contribuições e orçamentos. **Importar backup** faz o
  caminho inverso — escolhe esse mesmo tipo de arquivo e substitui
  completamente os dados atuais (pede confirmação antes, e cria um backup
  de segurança do estado atual logo antes de importar).
- **Lista de backups:** cada backup (automático, manual, ou criado
  automaticamente antes de uma importação/restauração) aparece na lista com
  data, tamanho e dois botões — **Baixar** (salva o arquivo `.db` no seu
  computador) e **Restaurar** (sobrescreve o banco atual com o conteúdo
  daquele backup, também com confirmação e backup de segurança prévio).
  O botão **Fazer backup agora** cria um backup manual na hora.
- **Aviso de backup fora da máquina:** como os backups automáticos ficam
  todos no mesmo disco, um aviso aparece na seção de dados quando faz mais
  de 7 dias (ou nunca aconteceu) desde a última vez que você baixou uma
  cópia — com um atalho direto pra exportar. Baixar qualquer backup ou usar
  "Exportar tudo" reseta essa contagem.

## API REST (caso queira integrar com outra coisa)

| Método | Rota                       | Descrição                              |
|--------|-----------------------------|------------------------------------------|
| GET    | `/api/entries`               | lista lançamentos (`?month=2026-07`)     |
| POST   | `/api/entries`               | cria lançamento                          |
| PUT    | `/api/entries/<id>`          | atualiza lançamento                      |
| DELETE | `/api/entries/<id>`          | remove lançamento                        |
| POST   | `/api/entries/<id>/repeat`    | gera as próximas N ocorrências mensais (`{months: 11}`, padrão 11) |
| POST   | `/api/entries/<id>/installments` | parcela o lançamento em N parcelas mensais (`{installments: 2..60}`, só pra Gasto) |
| DELETE | `/api/entries/<id>/series`    | apaga um grupo inteiro de recorrência ou parcelamento (`?scope=future` mantém o passado e apaga o resto, padrão; `?scope=all` apaga tudo) |
| GET    | `/api/summary`               | totais, série mensal e por categoria     |
| GET    | `/api/categories`             | lista categorias (`?kind=ganho\|gasto`)  |
| POST   | `/api/categories`             | cria categoria `{name, kind}`            |
| DELETE | `/api/categories/<id>`        | remove categoria                         |
| GET    | `/api/goals`                  | lista metas futuras (inclui `current_amount`, o saldo do cofrinho) |
| POST   | `/api/goals`                  | cria meta `{name, target_amount, target_date?}` |
| PUT    | `/api/goals/<id>`             | atualiza meta                            |
| DELETE | `/api/goals/<id>`             | remove meta (e suas contribuições)       |
| GET    | `/api/goals/<id>/contributions`    | lista as contribuições (depósitos/saques) do cofrinho da meta |
| POST   | `/api/goals/<id>/contributions`    | registra uma contribuição `{amount, date?, note?}` (`amount` negativo = retirada) |
| DELETE | `/api/goals/<id>/contributions/<contribution_id>` | remove uma contribuição e recalcula o saldo do cofrinho |
| GET    | `/api/budgets`                | lista orçamentos por categoria           |
| POST   | `/api/budgets`                | cria ou atualiza orçamento `{category, monthly_limit}` (upsert por categoria) |
| DELETE | `/api/budgets/<id>`           | remove orçamento                         |
| GET    | `/api/backups`                | lista os backups existentes (nome, data, tamanho) |
| POST   | `/api/backups`                | cria um backup manual agora              |
| GET    | `/api/backups/<filename>/download` | baixa o arquivo `.db` de um backup específico |
| POST   | `/api/backups/<filename>/restore`  | sobrescreve o banco atual com o conteúdo desse backup (cria um backup de segurança antes) |
| DELETE | `/api/backups/<filename>`     | remove um arquivo de backup              |
| GET    | `/api/backups/status`         | há quanto tempo não se baixa uma cópia dos dados (usado pelo aviso de backup fora da máquina) |
| GET    | `/api/export`                 | baixa um JSON com todos os dados (lançamentos, categorias, metas, contribuições, orçamentos) |
| POST   | `/api/import`                 | substitui todos os dados pelo conteúdo de um JSON no mesmo formato do `/api/export` (cria um backup de segurança antes) |

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
- **Backups:** quantidade mantida (`MAX_BACKUPS`, padrão 30) e intervalo do
  backup automático (`AUTO_BACKUP_INTERVAL_SECONDS`, padrão 24h) ficam no
  topo de `backend/app.py`. O prazo do aviso de "backup fora da máquina"
  (padrão 7 dias) é a constante `OFFSITE_REMINDER_DAYS` no topo de
  `frontend/static/script.js`.
