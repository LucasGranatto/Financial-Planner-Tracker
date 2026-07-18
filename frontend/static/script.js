// ============================================================================
// PLANNER — lógica de front-end
// Tabela estilo planilha (edição inline, auto-save) + categorias + gráficos
// ============================================================================

const API = "/api";

const el = {
  tbody: document.getElementById("ledger-body"),
  emptyState: document.getElementById("empty-state"),
  addRowBtn: document.getElementById("add-row-btn"),
  rowTemplate: document.getElementById("row-template"),
  saldoTotal: document.getElementById("saldo-total"),
  totalGanhos: document.getElementById("total-ganhos"),
  totalGastos: document.getElementById("total-gastos"),
  taxaEconomia: document.getElementById("taxa-economia"),
  todayLabel: document.getElementById("today-label"),
  categoryEmpty: document.getElementById("category-empty"),
  toggleCategoriesBtn: document.getElementById("toggle-categories-btn"),
  categoriesPanel: document.getElementById("categories-panel"),
  ganhoCategoryList: document.getElementById("ganho-category-list"),
  gastoCategoryList: document.getElementById("gasto-category-list"),
  ganhoCategoryForm: document.getElementById("ganho-category-form"),
  gastoCategoryForm: document.getElementById("gasto-category-form"),
  monthTabs: document.getElementById("month-tabs"),
  addGoalBtn: document.getElementById("add-goal-btn"),
  goalAddForm: document.getElementById("goal-add-form"),
  goalCancelBtn: document.getElementById("goal-cancel-btn"),
  goalsGrid: document.getElementById("goals-grid"),
  goalsEmpty: document.getElementById("goals-empty"),
  goalCardTemplate: document.getElementById("goal-card-template"),
};

let monthlyChart = null;
let categoryChart = null;

// cache local das categorias, atualizada sempre que a lista muda
let categoriesCache = [];

// cache local de todos os lançamentos (para calcular saldo corrente
// corretamente mesmo quando uma aba de mês está filtrando a visualização)
let entriesCache = [];

// mês selecionado nas abas ("AAAA-MM"); null até os lançamentos carregarem
let activeMonth = null;

// cache local das metas futuras + saldo atual (usado pra calcular o
// progresso de cada meta)
let goalsCache = [];
let currentSaldo = 0;

const currencyFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dateHeaderFmt = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
});

function formatCurrency(value) {
  return currencyFmt.format(value || 0);
}

// ----------------------------------------------------------------------------
// Inicialização
// ----------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  el.todayLabel.textContent = capitalize(dateHeaderFmt.format(new Date()));

  loadCategories().then(loadEntries);
  loadGoals();

  el.addRowBtn.addEventListener("click", () => createBlankRow());
  el.toggleCategoriesBtn.addEventListener("click", toggleCategoriesPanel);
  el.ganhoCategoryForm.addEventListener("submit", (e) => submitNewCategory(e, "ganho"));
  el.gastoCategoryForm.addEventListener("submit", (e) => submitNewCategory(e, "gasto"));

  el.addGoalBtn.addEventListener("click", () => {
    el.goalAddForm.hidden = !el.goalAddForm.hidden;
    if (!el.goalAddForm.hidden) el.goalAddForm.querySelector(".goal-add-name").focus();
  });
  el.goalCancelBtn.addEventListener("click", () => {
    el.goalAddForm.reset();
    el.goalAddForm.hidden = true;
  });
  el.goalAddForm.addEventListener("submit", submitNewGoal);
});

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ----------------------------------------------------------------------------
// Categorias
// ----------------------------------------------------------------------------

async function loadCategories() {
  try {
    const res = await fetch(`${API}/categories`);
    categoriesCache = await res.json();
    renderCategoryPanel();
    refreshAllRowCategorySelects();
  } catch (err) {
    console.error("Falha ao carregar categorias", err);
  }
}

function categoriesForKind(kind) {
  // categorias específicas do tipo + categorias marcadas como "ambos"
  return categoriesCache.filter((c) => c.kind === kind || c.kind === "ambos");
}

function toggleCategoriesPanel() {
  const isHidden = el.categoriesPanel.hidden;
  el.categoriesPanel.hidden = !isHidden;
  el.toggleCategoriesBtn.setAttribute("aria-expanded", String(isHidden));
  el.toggleCategoriesBtn.textContent = isHidden
    ? "Ocultar categorias"
    : "Gerenciar categorias";
}

function renderCategoryPanel() {
  renderCategoryColumn(el.ganhoCategoryList, categoriesForKind("ganho"));
  renderCategoryColumn(el.gastoCategoryList, categoriesForKind("gasto"));
}

function renderCategoryColumn(container, categories) {
  container.innerHTML = "";
  if (categories.length === 0) {
    const note = document.createElement("p");
    note.className = "category-empty-note";
    note.textContent = "Nenhuma categoria ainda.";
    container.appendChild(note);
    return;
  }
  for (const cat of categories) {
    const chip = document.createElement("span");
    chip.className = "category-chip";
    chip.textContent = cat.name;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "✕";
    removeBtn.title = `Remover categoria "${cat.name}"`;
    removeBtn.addEventListener("click", () => deleteCategory(cat.id));

    chip.appendChild(removeBtn);
    container.appendChild(chip);
  }
}

async function submitNewCategory(event, kind) {
  event.preventDefault();
  const form = event.target;
  const input = form.querySelector(".category-add-input");
  const name = input.value.trim();
  if (!name) return;

  try {
    const res = await fetch(`${API}/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, kind }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert((data.errors && data.errors[0]) || "Não foi possível adicionar a categoria.");
      return;
    }
    input.value = "";
    await loadCategories();
  } catch (err) {
    console.error(err);
    alert("Não foi possível adicionar a categoria. Verifique se o backend está rodando.");
  }
}

async function deleteCategory(id) {
  if (!confirm("Remover esta categoria? Lançamentos existentes manterão o nome atual.")) return;
  try {
    await fetch(`${API}/categories/${id}`, { method: "DELETE" });
    await loadCategories();
  } catch (err) {
    console.error(err);
  }
}

function populateCategorySelect(selectEl, kind, selectedValue) {
  const options = categoriesForKind(kind);
  selectEl.innerHTML = options
    .map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`)
    .join("");

  // se o valor atual não estiver na lista (categoria digitada/legada), adiciona como opção
  if (selectedValue && !options.some((c) => c.name === selectedValue)) {
    const extra = document.createElement("option");
    extra.value = selectedValue;
    extra.textContent = selectedValue;
    selectEl.appendChild(extra);
  }
  selectEl.value = selectedValue || (options[0] ? options[0].name : "");
}

function refreshAllRowCategorySelects() {
  const rows = el.tbody.querySelectorAll(".ledger-row");
  rows.forEach((row) => {
    const catSelect = row.querySelector(".cell-cat");
    const type = row.dataset.type;
    populateCategorySelect(catSelect, type, catSelect.value);
  });
}

// ----------------------------------------------------------------------------
// Metas futuras
// ----------------------------------------------------------------------------

async function loadGoals() {
  try {
    const res = await fetch(`${API}/goals`);
    goalsCache = await res.json();
    renderGoals();
  } catch (err) {
    console.error("Falha ao carregar metas", err);
  }
}

// O progresso de cada meta é calculado a partir do saldo acumulado atual —
// uma aproximação simples e transparente de "quanto você já tem guardado".
function renderGoals() {
  el.goalsGrid.innerHTML = "";
  el.goalsEmpty.hidden = goalsCache.length > 0;

  for (const goal of goalsCache) {
    const card = buildGoalCard(goal);
    el.goalsGrid.appendChild(card);
  }
}

function buildGoalCard(goal) {
  const fragment = el.goalCardTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".goal-card");

  const saldoAtual = Math.max(currentSaldo, 0);
  const pct = goal.target_amount > 0
    ? Math.min(100, (saldoAtual / goal.target_amount) * 100)
    : 0;
  const complete = saldoAtual >= goal.target_amount;

  card.querySelector(".goal-name").textContent = goal.name;
  card.querySelector(".goal-current").textContent = formatCurrency(saldoAtual);
  card.querySelector(".goal-target").textContent = `de ${formatCurrency(goal.target_amount)}`;

  const fill = card.querySelector(".goal-progress-fill");
  fill.style.width = `${pct}%`;
  fill.classList.toggle("is-complete", complete);

  const label = card.querySelector(".goal-progress-label");
  label.textContent = complete
    ? "Meta atingida! 🎉"
    : `${pct.toFixed(0)}% · faltam ${formatCurrency(goal.target_amount - saldoAtual)}`;

  const dateBadge = card.querySelector(".goal-date-badge");
  if (goal.target_date) {
    const [y, m, d] = goal.target_date.split("-");
    dateBadge.textContent = `${d}/${m}/${y.slice(2)}`;
  } else {
    dateBadge.remove();
  }

  card.querySelector(".goal-delete").addEventListener("click", () => deleteGoal(goal.id));

  return fragment;
}

async function submitNewGoal(event) {
  event.preventDefault();
  const form = event.target;
  const name = form.querySelector(".goal-add-name").value.trim();
  const amount = parseFloat(form.querySelector(".goal-add-amount").value || "0");
  const date = form.querySelector(".goal-add-date").value || null;

  try {
    const res = await fetch(`${API}/goals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, target_amount: amount, target_date: date }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert((data.errors && data.errors[0]) || "Não foi possível criar a meta.");
      return;
    }
    form.reset();
    form.hidden = true;
    await loadGoals();
  } catch (err) {
    console.error(err);
    alert("Não foi possível criar a meta. Verifique se o backend está rodando.");
  }
}

async function deleteGoal(id) {
  if (!confirm("Excluir esta meta?")) return;
  try {
    await fetch(`${API}/goals/${id}`, { method: "DELETE" });
    await loadGoals();
  } catch (err) {
    console.error(err);
  }
}

// ----------------------------------------------------------------------------
// Carregar e renderizar lançamentos
// ----------------------------------------------------------------------------

async function loadEntries() {
  try {
    const res = await fetch(`${API}/entries`);
    entriesCache = await res.json();
    renderMonthTabs();
    renderRows();
    loadSummary();
  } catch (err) {
    console.error("Falha ao carregar lançamentos", err);
  }
}

// Calcula o saldo corrente de cada lançamento em ordem cronológica (sempre
// sobre a lista completa) e devolve pares [entry, saldoNaquelaLinha].
function entriesWithRunningBalance() {
  let running = 0;
  return entriesCache.map((entry) => {
    running += entry.type === "ganho" ? entry.amount : -entry.amount;
    return { entry, balance: running };
  });
}

function monthKeyOf(entry) {
  return entry.date.slice(0, 7);
}

// Constrói as abas de mês a partir dos meses presentes nos lançamentos —
// sem uma aba "Todos": o livro sempre mostra um mês por vez. Cada aba
// mostra um ponto colorido indicando se aquele mês fechou no positivo
// (verde) ou no negativo (vermelho).
function renderMonthTabs() {
  const monthTotals = new Map(); // "AAAA-MM" -> economia do mês
  for (const entry of entriesCache) {
    const key = monthKeyOf(entry);
    const delta = entry.type === "ganho" ? entry.amount : -entry.amount;
    monthTotals.set(key, (monthTotals.get(key) || 0) + delta);
  }

  const months = Array.from(monthTotals.keys()).sort();

  el.monthTabs.innerHTML = "";

  if (months.length === 0) {
    activeMonth = null;
    return; // nada para mostrar ainda
  }

  // se o mês ativo não existe (primeira carga, ou a última linha daquele
  // mês foi apagada), escolhe o mês atual (se houver lançamentos nele) ou
  // cai para o mês mais recente disponível
  if (!activeMonth || !monthTotals.has(activeMonth)) {
    const currentKey = new Date().toISOString().slice(0, 7);
    activeMonth = monthTotals.has(currentKey) ? currentKey : months[months.length - 1];
  }

  for (const key of months) {
    const economia = monthTotals.get(key);
    const dotClass = economia > 0 ? "up" : economia < 0 ? "down" : null;
    const tab = buildMonthTabButton(key, monthLabel(key), dotClass);
    el.monthTabs.appendChild(tab);
  }
}

function buildMonthTabButton(key, label, dotClass) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "month-tab" + (key === activeMonth ? " is-active" : "");
  btn.dataset.month = key;

  if (dotClass) {
    const dot = document.createElement("span");
    dot.className = `month-tab-dot month-tab-dot--${dotClass}`;
    btn.appendChild(dot);
  }

  const text = document.createElement("span");
  text.textContent = label;
  btn.appendChild(text);

  btn.addEventListener("click", () => {
    if (activeMonth === key) return;
    activeMonth = key;
    renderMonthTabs();
    renderRows();
  });

  return btn;
}

function renderRows() {
  el.tbody.innerHTML = "";

  const withBalance = entriesWithRunningBalance();
  const visible = activeMonth
    ? withBalance.filter(({ entry }) => monthKeyOf(entry) === activeMonth)
    : [];

  el.emptyState.hidden = visible.length > 0;
  if (entriesCache.length > 0 && visible.length === 0) {
    el.emptyState.textContent = "Nenhum lançamento neste mês.";
  } else {
    el.emptyState.innerHTML =
      "Nenhum lançamento ainda. Clique em <strong>+ Novo lançamento</strong> para abrir a primeira linha do seu planner.";
  }

  for (const { entry, balance } of visible) {
    const row = buildRow(entry, balance);
    el.tbody.appendChild(row);
  }
}

function buildRow(entry, runningBalance) {
  const fragment = el.rowTemplate.content.cloneNode(true);
  const tr = fragment.querySelector("tr");
  tr.dataset.id = entry.id;
  tr.dataset.type = entry.type;

  const dateInput = tr.querySelector(".cell-date");
  const descInput = tr.querySelector(".cell-desc");
  const catSelect = tr.querySelector(".cell-cat");
  const typeSelect = tr.querySelector(".cell-type");
  const amountInput = tr.querySelector(".cell-amount");
  const balanceSpan = tr.querySelector(".cell-balance");
  const deleteBtn = tr.querySelector(".row-delete");

  dateInput.value = entry.date;
  descInput.value = entry.description;
  typeSelect.value = entry.type;
  populateCategorySelect(catSelect, entry.type, entry.category);
  amountInput.value = entry.amount;
  balanceSpan.textContent = formatCurrency(runningBalance);
  balanceSpan.style.color =
    runningBalance < 0 ? "var(--accent-gasto)" : "var(--text-muted)";

  const commit = () => saveRow(tr, {
    date: dateInput.value,
    description: descInput.value,
    category: catSelect.value,
    type: typeSelect.value,
    amount: parseFloat(amountInput.value || "0"),
  });

  [dateInput, descInput, catSelect, amountInput].forEach((input) =>
    input.addEventListener("change", commit)
  );
  typeSelect.addEventListener("change", () => {
    tr.dataset.type = typeSelect.value;
    populateCategorySelect(catSelect, typeSelect.value, null);
    commit();
  });

  deleteBtn.addEventListener("click", () => deleteRow(tr));

  return fragment;
}

// ----------------------------------------------------------------------------
// Criar / salvar / excluir linhas
// ----------------------------------------------------------------------------

async function createBlankRow() {
  const today = new Date().toISOString().slice(0, 10);
  const defaultCategory = categoriesForKind("gasto")[0]?.name || "Outros gastos";
  try {
    const res = await fetch(`${API}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: today,
        description: "",
        category: defaultCategory,
        type: "gasto",
        amount: 0,
      }),
    });
    if (!res.ok) throw new Error("Erro ao criar lançamento");
    activeMonth = today.slice(0, 7);
    await loadEntries();
    focusLastRowDescription();
  } catch (err) {
    console.error(err);
    alert("Não foi possível criar o lançamento. Verifique se o backend está rodando.");
  }
}

async function saveRow(tr, payload) {
  const id = tr.dataset.id;
  try {
    const res = await fetch(`${API}/entries/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Erro ao salvar");
    await loadEntries();
  } catch (err) {
    console.error(err);
  }
}

async function deleteRow(tr) {
  const id = tr.dataset.id;
  if (!confirm("Excluir este lançamento?")) return;
  try {
    const res = await fetch(`${API}/entries/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Erro ao excluir");
    await loadEntries();
  } catch (err) {
    console.error(err);
  }
}

function focusLastRowDescription() {
  const rows = el.tbody.querySelectorAll(".ledger-row");
  const last = rows[rows.length - 1];
  if (last) last.querySelector(".cell-desc").focus();
}

// ----------------------------------------------------------------------------
// Resumo + gráficos
// ----------------------------------------------------------------------------

async function loadSummary() {
  try {
    const res = await fetch(`${API}/summary`);
    const data = await res.json();
    renderStats(data);
    renderMonthlyChart(data.monthly);
    renderCategoryChart(data.by_category);
  } catch (err) {
    console.error("Falha ao carregar resumo", err);
  }
}

function renderStats(data) {
  currentSaldo = data.saldo;

  el.saldoTotal.textContent = formatCurrency(data.saldo);
  el.saldoTotal.style.color = data.saldo < 0 ? "var(--accent-gasto)" : "var(--text)";
  el.totalGanhos.textContent = formatCurrency(data.total_ganhos);
  el.totalGastos.textContent = formatCurrency(data.total_gastos);

  const taxa = data.total_ganhos > 0
    ? (data.saldo / data.total_ganhos) * 100
    : 0;
  el.taxaEconomia.textContent = `${taxa.toFixed(1)}%`;

  renderGoals();
}

function monthLabel(monthKey) {
  const [year, month] = monthKey.split("-");
  return `${month}/${year.slice(2)}`;
}

// Gráfico redesenhado: em vez de barras agrupadas + linha em eixo duplo
// (difícil de comparar de relance), ganhos sobem a partir do zero e gastos
// descem a partir do zero — a "forma" do mês aparece num único olhar.
// O saldo acumulado vira uma linha fina no mesmo eixo, mostrando a
// tendência por cima das barras.
function renderMonthlyChart(monthly) {
  const ctx = document.getElementById("monthly-chart");
  const labels = monthly.map((m) => monthLabel(m.month));
  const ganhos = monthly.map((m) => m.ganhos);
  const gastosNegativos = monthly.map((m) => -m.gastos);
  const saldoAcumulado = monthly.map((m) => m.saldo_acumulado);

  if (monthlyChart) monthlyChart.destroy();

  monthlyChart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Ganhos",
          data: ganhos,
          backgroundColor: "rgba(34,195,130,0.7)",
          borderRadius: 4,
          order: 2,
          stack: "fluxo",
        },
        {
