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
  yearTabs: document.getElementById("year-tabs"),
  addGoalBtn: document.getElementById("add-goal-btn"),
  goalAddForm: document.getElementById("goal-add-form"),
  goalCancelBtn: document.getElementById("goal-cancel-btn"),
  goalsGrid: document.getElementById("goals-grid"),
  goalsEmpty: document.getElementById("goals-empty"),
  goalCardTemplate: document.getElementById("goal-card-template"),
  ledgerSearch: document.getElementById("ledger-search"),
  monthCompare: document.getElementById("month-compare"),
  addBudgetBtn: document.getElementById("add-budget-btn"),
  budgetAddForm: document.getElementById("budget-add-form"),
  budgetCancelBtn: document.getElementById("budget-cancel-btn"),
  budgetsGrid: document.getElementById("budgets-grid"),
  budgetsEmpty: document.getElementById("budgets-empty"),
  budgetCardTemplate: document.getElementById("budget-card-template"),
  themeToggleBtn: document.getElementById("theme-toggle-btn"),
  shortcutsBtn: document.getElementById("shortcuts-btn"),
  shortcutsOverlay: document.getElementById("shortcuts-overlay"),
  shortcutsCloseBtn: document.getElementById("shortcuts-close-btn"),
  exportCsvBtn: document.getElementById("export-csv-btn"),
  exportPdfBtn: document.getElementById("export-pdf-btn"),
  exportDataBtn: document.getElementById("export-data-btn"),
  importDataBtn: document.getElementById("import-data-btn"),
  importFileInput: document.getElementById("import-file-input"),
  backupNowBtn: document.getElementById("backup-now-btn"),
  backupsList: document.getElementById("backups-list"),
  backupsEmpty: document.getElementById("backups-empty"),
  confirmOverlay: document.getElementById("confirm-overlay"),
  confirmTitle: document.getElementById("confirm-title"),
  confirmMessage: document.getElementById("confirm-message"),
  confirmCancelBtn: document.getElementById("confirm-cancel-btn"),
  confirmSecondaryBtn: document.getElementById("confirm-secondary-btn"),
  confirmCloseBtn: document.getElementById("confirm-close-btn"),
  confirmOkBtn: document.getElementById("confirm-ok-btn"),
  offsiteBanner: document.getElementById("offsite-banner"),
  offsiteBannerText: document.getElementById("offsite-banner-text"),
  offsiteBannerAction: document.getElementById("offsite-banner-action"),
  undoToast: document.getElementById("undo-toast"),
  undoToastMessage: document.getElementById("undo-toast-message"),
  undoToastBtn: document.getElementById("undo-toast-btn"),
  yearlyCard: document.getElementById("yearly-card"),
  yearlyChartCanvas: document.getElementById("yearly-chart"),
  yearlyTable: document.getElementById("yearly-table"),
};

let monthlyChart = null;
let yearlyChart = null;
let categoryChart = null;

// cache local das categorias, atualizada sempre que a lista muda
let categoriesCache = [];

// cache local de todos os lançamentos (para calcular saldo corrente
// corretamente mesmo quando uma aba de mês está filtrando a visualização)
let entriesCache = [];

// mês selecionado nas abas ("AAAA-MM"); null até os lançamentos carregarem
let activeMonth = null;
let selectedYear = null;

// cache local das metas futuras + saldo atual (usado pra calcular o
// progresso de cada meta)
let goalsCache = [];
let currentSaldo = 0;

// cache local dos orçamentos por categoria
let budgetsCache = [];

// texto de busca ativo no livro de lançamentos (filtra por descrição/categoria)
let searchQuery = "";

// série mensal (ganhos/gastos/economia por mês) da última carga do resumo,
// usada pra comparar o mês ativo com o mês anterior
let monthlySeriesCache = [];

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

// A API sempre fala em AAAA-MM-DD (ISO); a coluna de data mostra e edita
// no formato brasileiro dd/mm/aa (ano com 2 dígitos, igual às abas de mês).
function formatDateDisplay(isoDate) {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year.slice(2)}`;
}

function parseDateDisplay(displayDate) {
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec((displayDate || "").trim());
  if (!match) return null;
  const [, day, month, shortYear] = match;
  const year = `20${shortYear}`;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00`);
  const valid =
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() + 1 === Number(month) &&
    date.getUTCDate() === Number(day);
  return valid ? iso : null;
}

// Adiciona as barras "/" conforme a pessoa digita (dd -> dd/ -> dd/mm ->
// dd/mm/ -> dd/mm/aa), preservando a posição do cursor pra não atrapalhar
// quem está corrigindo um dígito no meio do campo.
function maskDateInput(event) {
  const input = event.target;
  const prevLength = input.value.length;
  const cursorPos = input.selectionStart;

  const digits = input.value.replace(/\D/g, "").slice(0, 6);
  let formatted = digits;
  if (digits.length > 4) {
    formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 6)}`;
  } else if (digits.length > 2) {
    formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}`;
  }

  input.value = formatted;
  const newPos = Math.max(0, cursorPos + (formatted.length - prevLength));
  input.setSelectionRange(newPos, newPos);
}

// Abre o seletor de data nativo do navegador (o calendário) a partir de um
// input[type=date] escondido, usado só como "motor" do calendário.
function openDatePicker(nativeInput) {
  if (typeof nativeInput.showPicker === "function") {
    try {
      nativeInput.showPicker();
      return;
    } catch (err) {
      // alguns navegadores recusam showPicker em certas condições; cai
      // pro fallback abaixo
    }
  }
  nativeInput.focus();
}

// ----------------------------------------------------------------------------
// Inicialização
// ----------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  el.todayLabel.textContent = capitalize(dateHeaderFmt.format(new Date()));

  loadCategories().then(loadEntries);
  loadGoals();
  loadBudgets();

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

  el.addBudgetBtn.addEventListener("click", () => {
    el.budgetAddForm.hidden = !el.budgetAddForm.hidden;
    if (!el.budgetAddForm.hidden) {
      populateCategorySelect(
        el.budgetAddForm.querySelector(".budget-add-category"),
        "gasto",
        null
      );
    }
  });
  el.budgetCancelBtn.addEventListener("click", () => {
    el.budgetAddForm.reset();
    el.budgetAddForm.hidden = true;
  });
  el.budgetAddForm.addEventListener("submit", submitNewBudget);

  el.ledgerSearch.addEventListener("input", (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderRows();
  });

  initTheme();
  initShortcuts();
  el.exportCsvBtn.addEventListener("click", exportCsv);
  el.exportPdfBtn.addEventListener("click", exportPdf);

  initDataSafety();
  loadBackups();
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
    removeBtn.addEventListener("click", () => deleteCategory(cat.id, chip));

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

async function deleteCategory(id, chip) {
  pendingDeleteUI(chip, "Categoria removida.", async () => {
    try {
      await fetch(`${API}/categories/${id}`, { method: "DELETE" });
    } catch (err) {
      console.error(err);
    } finally {
      await loadCategories();
    }
  });
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

// O progresso de cada meta agora vem de um cofrinho próprio: a soma das
// contribuições manuais (depósitos/retiradas) registradas para aquela meta,
// totalmente independente do saldo geral do planner.
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

  const saved = Math.max(goal.current_amount || 0, 0);
  const pct = goal.target_amount > 0
    ? Math.min(100, (saved / goal.target_amount) * 100)
    : 0;
  const complete = saved >= goal.target_amount;

  card.querySelector(".goal-name").textContent = goal.name;
  card.querySelector(".goal-current").textContent = formatCurrency(saved);
  card.querySelector(".goal-target").textContent = `de ${formatCurrency(goal.target_amount)}`;

  const fill = card.querySelector(".goal-progress-fill");
  fill.style.width = `${pct}%`;
  fill.classList.toggle("is-complete", complete);

  const label = card.querySelector(".goal-progress-label");
  label.textContent = complete
    ? "Meta atingida! 🎉"
    : `${pct.toFixed(0)}% · faltam ${formatCurrency(goal.target_amount - saved)}`;

  const dateBadge = card.querySelector(".goal-date-badge");
  if (goal.target_date) {
    const [y, m, d] = goal.target_date.split("-");
    dateBadge.textContent = `${d}/${m}/${y.slice(2)}`;
  } else {
    dateBadge.remove();
  }

  card.querySelector(".goal-delete").addEventListener("click", () => deleteGoal(goal.id, card));

  const contributeForm = card.querySelector(".goal-contribute-form");
  const amountInput = card.querySelector(".goal-contribute-amount");
  const depositBtn = card.querySelector(".goal-contribute-btn--deposit");
  const withdrawBtn = card.querySelector(".goal-contribute-btn--withdraw");

  contributeForm.addEventListener("submit", (e) => {
    e.preventDefault();
    submitContribution(goal.id, amountInput, "deposit");
  });
  withdrawBtn.addEventListener("click", () => submitContribution(goal.id, amountInput, "withdraw"));

  const historyToggle = card.querySelector(".goal-history-toggle");
  const historyList = card.querySelector(".goal-history-list");
  historyToggle.addEventListener("click", () => toggleGoalHistory(goal.id, historyToggle, historyList));

  return fragment;
}

async function submitContribution(goalId, amountInput, action) {
  const rawValue = parseFloat(amountInput.value || "0");
  if (!rawValue || rawValue <= 0) {
    alert("Informe um valor maior que zero.");
    return;
  }
  const amount = action === "withdraw" ? -Math.abs(rawValue) : Math.abs(rawValue);

  try {
    const res = await fetch(`${API}/goals/${goalId}/contributions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert((data.errors && data.errors[0]) || "Não foi possível registrar a contribuição.");
      return;
    }
    amountInput.value = "";
    await loadGoals();
  } catch (err) {
    console.error(err);
    alert("Não foi possível registrar a contribuição. Verifique se o backend está rodando.");
  }
}

async function toggleGoalHistory(goalId, toggleBtn, listEl) {
  const opening = listEl.hidden;
  if (!opening) {
    listEl.hidden = true;
    toggleBtn.textContent = "Ver histórico de contribuições";
    return;
  }

  toggleBtn.textContent = "Carregando...";
  try {
    const res = await fetch(`${API}/goals/${goalId}/contributions`);
    const contributions = await res.json();
    renderGoalHistory(goalId, listEl, contributions);
    listEl.hidden = false;
    toggleBtn.textContent = "Ocultar histórico de contribuições";
  } catch (err) {
    console.error(err);
    toggleBtn.textContent = "Ver histórico de contribuições";
    alert("Não foi possível carregar o histórico dessa meta.");
  }
}

function renderGoalHistory(goalId, listEl, contributions) {
  listEl.innerHTML = "";

  if (contributions.length === 0) {
    const empty = document.createElement("li");
    empty.className = "goal-history-empty";
    empty.textContent = "Nenhuma contribuição registrada ainda.";
    listEl.appendChild(empty);
    return;
  }

  for (const contribution of contributions) {
    const li = document.createElement("li");
    li.className = "goal-history-item";

    const info = document.createElement("div");
    info.className = "goal-history-item-info";

    const dateSpan = document.createElement("span");
    dateSpan.className = "goal-history-date";
    dateSpan.textContent = formatDateDisplay(contribution.date);
    info.appendChild(dateSpan);

    if (contribution.note) {
      const noteSpan = document.createElement("span");
      noteSpan.className = "goal-history-note";
      noteSpan.textContent = contribution.note;
      info.appendChild(noteSpan);
    }

    const amountSpan = document.createElement("span");
    const isDeposit = contribution.amount >= 0;
    amountSpan.className = `goal-history-amount ${isDeposit ? "is-deposit" : "is-withdraw"}`;
    amountSpan.textContent = `${isDeposit ? "+" : "−"} ${formatCurrency(Math.abs(contribution.amount))}`;

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "goal-history-delete";
    deleteBtn.title = "Remover contribuição";
    deleteBtn.setAttribute("aria-label", "Remover contribuição");
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("click", () => deleteContribution(goalId, contribution.id, listEl, li));

    li.appendChild(info);
    li.appendChild(amountSpan);
    li.appendChild(deleteBtn);
    listEl.appendChild(li);
  }
}

async function deleteContribution(goalId, contributionId, listEl, li) {
  pendingDeleteUI(li, "Contribuição removida.", async () => {
    try {
      const res = await fetch(`${API}/goals/${goalId}/contributions/${contributionId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        alert((data.errors && data.errors[0]) || "Não foi possível remover a contribuição.");
        return;
      }
      renderGoalHistory(goalId, listEl, data.contributions);
      await loadGoals();
    } catch (err) {
      console.error(err);
      alert("Não foi possível remover a contribuição. Verifique se o backend está rodando.");
    }
  });
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

async function deleteGoal(id, card) {
  pendingDeleteUI(card, "Meta excluída.", async () => {
    try {
      await fetch(`${API}/goals/${id}`, { method: "DELETE" });
    } catch (err) {
      console.error(err);
    } finally {
      await loadGoals();
    }
  });
}

// ----------------------------------------------------------------------------
// Orçamentos por categoria
// ----------------------------------------------------------------------------

async function loadBudgets() {
  try {
    const res = await fetch(`${API}/budgets`);
    budgetsCache = await res.json();
    renderBudgets();
  } catch (err) {
    console.error("Falha ao carregar orçamentos", err);
  }
}

// Quanto já foi gasto em cada categoria, só dentro do mês selecionado nas
// abas do livro de lançamentos — os orçamentos acompanham o mês ativo.
function spentByCategoryInActiveMonth() {
  const spent = new Map();
  if (!activeMonth) return spent;
  for (const entry of entriesCache) {
    if (entry.type !== "gasto" || monthKeyOf(entry) !== activeMonth) continue;
    spent.set(entry.category, (spent.get(entry.category) || 0) + entry.amount);
  }
  return spent;
}

function renderBudgets() {
  el.budgetsGrid.innerHTML = "";
  el.budgetsEmpty.hidden = budgetsCache.length > 0;

  const spent = spentByCategoryInActiveMonth();
  for (const budget of budgetsCache) {
    const card = buildBudgetCard(budget, spent.get(budget.category) || 0);
    el.budgetsGrid.appendChild(card);
  }
}

function buildBudgetCard(budget, spentAmount) {
  const fragment = el.budgetCardTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".budget-card");

  const pct = budget.monthly_limit > 0
    ? Math.min(100, (spentAmount / budget.monthly_limit) * 100)
    : 0;
  const over = spentAmount > budget.monthly_limit;
  const warning = !over && pct >= 80;

  card.querySelector(".budget-category").textContent = budget.category;
  card.querySelector(".budget-spent").textContent = formatCurrency(spentAmount);
  card.querySelector(".budget-limit").textContent = `de ${formatCurrency(budget.monthly_limit)}`;

  const fill = card.querySelector(".budget-progress-fill");
  fill.style.width = `${pct}%`;
  fill.classList.toggle("is-warning", warning);
  fill.classList.toggle("is-over", over);

  const label = card.querySelector(".budget-progress-label");
  label.textContent = over
    ? `Estourou em ${formatCurrency(spentAmount - budget.monthly_limit)}`
    : `${pct.toFixed(0)}% do orçamento do mês`;

  card.querySelector(".budget-delete").addEventListener("click", () => deleteBudget(budget.id, card));

  return fragment;
}

async function submitNewBudget(event) {
  event.preventDefault();
  const form = event.target;
  const category = form.querySelector(".budget-add-category").value;
  const limit = parseFloat(form.querySelector(".budget-add-amount").value || "0");

  try {
    const res = await fetch(`${API}/budgets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, monthly_limit: limit }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert((data.errors && data.errors[0]) || "Não foi possível salvar o orçamento.");
      return;
    }
    form.reset();
    form.hidden = true;
    await loadBudgets();
  } catch (err) {
    console.error(err);
    alert("Não foi possível salvar o orçamento. Verifique se o backend está rodando.");
  }
}

async function deleteBudget(id, card) {
  pendingDeleteUI(card, "Orçamento removido.", async () => {
    try {
      await fetch(`${API}/budgets/${id}`, { method: "DELETE" });
    } catch (err) {
      console.error(err);
    } finally {
      await loadBudgets();
    }
  });
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

// Constrói as abas de ano (só aparecem quando há lançamentos em mais de um
// ano) e as abas de mês a partir dos meses presentes nos lançamentos —
// sem uma aba "Todos": o livro sempre mostra um mês por vez. Cada aba
// mostra um ponto colorido indicando se aquele mês fechou no positivo
// (verde) ou no negativo (vermelho).
function renderYearTabs() {
  const years = Array.from(new Set(entriesCache.map((e) => e.date.slice(0, 4)))).sort();

  if (years.length <= 1) {
    el.yearTabs.hidden = true;
    el.yearTabs.innerHTML = "";
    selectedYear = years[0] || null;
    return;
  }

  if (!selectedYear || !years.includes(selectedYear)) {
    selectedYear = activeMonth ? activeMonth.slice(0, 4) : years[years.length - 1];
  }

  el.yearTabs.hidden = false;
  el.yearTabs.innerHTML = "";
  for (const year of years) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "year-tab" + (year === selectedYear ? " is-active" : "");
    btn.textContent = year;
    btn.addEventListener("click", () => {
      if (selectedYear === year) return;
      selectedYear = year;
      activeMonth = null; // força escolher um mês dentro do ano selecionado
      renderMonthTabs();
      renderRows();
      renderMonthCompare();
    });
    el.yearTabs.appendChild(btn);
  }
}

function renderMonthTabs() {
  renderYearTabs();

  const monthTotals = new Map(); // "AAAA-MM" -> economia do mês
  for (const entry of entriesCache) {
    const key = monthKeyOf(entry);
    const delta = entry.type === "ganho" ? entry.amount : -entry.amount;
    monthTotals.set(key, (monthTotals.get(key) || 0) + delta);
  }

  const months = Array.from(monthTotals.keys())
    .filter((key) => !selectedYear || key.startsWith(selectedYear))
    .sort();

  el.monthTabs.innerHTML = "";

  if (months.length === 0) {
    activeMonth = null;
    return; // nada para mostrar ainda
  }

  // se o mês ativo não existe (primeira carga, mudança de ano, ou a última
  // linha daquele mês foi apagada), escolhe o mês atual (se houver
  // lançamentos nele) ou cai para o mês mais recente disponível dentro do
  // ano selecionado
  if (!activeMonth || !months.includes(activeMonth)) {
    const currentKey = new Date().toISOString().slice(0, 7);
    activeMonth = months.includes(currentKey) ? currentKey : months[months.length - 1];
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
    renderMonthCompare();
  });

  return btn;
}

function renderRows() {
  el.tbody.innerHTML = "";

  const withBalance = entriesWithRunningBalance();
  let visible = activeMonth
    ? withBalance.filter(({ entry }) => monthKeyOf(entry) === activeMonth)
    : [];

  if (searchQuery) {
    visible = visible.filter(({ entry }) =>
      entry.description.toLowerCase().includes(searchQuery) ||
      entry.category.toLowerCase().includes(searchQuery)
    );
  }

  el.emptyState.hidden = visible.length > 0;
  if (searchQuery && visible.length === 0) {
    el.emptyState.textContent = "Nenhum lançamento encontrado pra essa busca.";
  } else if (entriesCache.length > 0 && visible.length === 0) {
    el.emptyState.textContent = "Nenhum lançamento neste mês.";
  } else {
    el.emptyState.innerHTML =
      "Nenhum lançamento ainda. Clique em <strong>+ Novo lançamento</strong> para abrir a primeira linha do seu planner.";
  }

  for (const { entry, balance } of visible) {
    const row = buildRow(entry, balance);
    el.tbody.appendChild(row);
  }

  renderBudgets();
}

function buildRow(entry, runningBalance) {
  const fragment = el.rowTemplate.content.cloneNode(true);
  const tr = fragment.querySelector("tr");
  tr.dataset.id = entry.id;
  tr.dataset.type = entry.type;

  const dateInput = tr.querySelector(".cell-date");
  const dateNativeInput = tr.querySelector(".cell-date-native");
  const datePickerBtn = tr.querySelector(".date-picker-btn");
  const descInput = tr.querySelector(".cell-desc");
  const catSelect = tr.querySelector(".cell-cat");
  const typeSelect = tr.querySelector(".cell-type");
  const amountInput = tr.querySelector(".cell-amount");
  const balanceSpan = tr.querySelector(".cell-balance");
  const recurringBadge = tr.querySelector(".recurring-badge");
  const installmentBadge = tr.querySelector(".installment-badge");
  const repeatBtn = tr.querySelector(".row-repeat");
  const installmentBtn = tr.querySelector(".row-installment");
  const deleteBtn = tr.querySelector(".row-delete");

  let lastGoodDate = entry.date;
  dateInput.value = formatDateDisplay(entry.date);
  dateNativeInput.value = entry.date;
  descInput.value = entry.description;
  typeSelect.value = entry.type;
  populateCategorySelect(catSelect, entry.type, entry.category);
  amountInput.value = entry.amount;
  balanceSpan.textContent = formatCurrency(runningBalance);
  balanceSpan.style.color =
    runningBalance < 0 ? "var(--accent-gasto)" : "var(--text-muted)";

  recurringBadge.hidden = !entry.is_recurring;
  repeatBtn.classList.toggle("is-active", entry.is_recurring);
  repeatBtn.title = entry.is_recurring
    ? "Já repete todo mês"
    : "Repetir todo mês";
  repeatBtn.addEventListener("click", () => repeatEntry(entry.id, entry.is_recurring));

  const isInstallment = Boolean(entry.installment_total);
  installmentBadge.hidden = !isInstallment;
  if (isInstallment) {
    installmentBadge.textContent = `${entry.installment_current}/${entry.installment_total}`;
  }
  installmentBtn.classList.toggle("is-active", isInstallment);
  installmentBtn.title = isInstallment
    ? `Parcela ${entry.installment_current} de ${entry.installment_total}`
    : "Parcelar compra";
  installmentBtn.hidden = entry.type !== "gasto";
  installmentBtn.addEventListener("click", () => installmentEntry(entry.id, isInstallment));

  const commit = () => saveRow(tr, {
    date: lastGoodDate,
    description: descInput.value,
    category: catSelect.value,
    type: typeSelect.value,
    amount: parseFloat(amountInput.value || "0"),
  });

  dateInput.addEventListener("input", maskDateInput);
  dateInput.addEventListener("change", () => {
    const iso = parseDateDisplay(dateInput.value);
    if (!iso) {
      alert("Data inválida. Use o formato dd/mm/aa.");
      dateInput.value = formatDateDisplay(lastGoodDate);
      dateInput.focus();
      return;
    }
    lastGoodDate = iso;
    dateNativeInput.value = iso;
    commit();
  });
  dateNativeInput.addEventListener("change", () => {
    if (!dateNativeInput.value) return;
    lastGoodDate = dateNativeInput.value;
    dateInput.value = formatDateDisplay(lastGoodDate);
    commit();
  });
  datePickerBtn.addEventListener("click", () => openDatePicker(dateNativeInput));

  [descInput, catSelect, amountInput].forEach((input) =>
    input.addEventListener("change", commit)
  );
  typeSelect.addEventListener("change", () => {
    tr.dataset.type = typeSelect.value;
    populateCategorySelect(catSelect, typeSelect.value, null);
    installmentBtn.hidden = typeSelect.value !== "gasto";
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
  pendingDeleteUI(tr, "Lançamento excluído.", async () => {
    try {
      const res = await fetch(`${API}/entries/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Erro ao excluir");
    } catch (err) {
      console.error(err);
    } finally {
      await loadEntries();
    }
  });
}

async function repeatEntry(id, alreadyRecurring) {
  if (alreadyRecurring) {
    const result = await askConfirm(
      "Essa recorrência já existe",
      "Você pode gerar novamente os meses que ainda faltam (sem duplicar), ou parar a recorrência agora — apagando esta ocorrência e as futuras (as que já venceram no passado continuam no histórico).",
      { confirmLabel: "Gerar meses que faltam", secondaryLabel: "Parar recorrência" }
    );
    if (result === "secondary") {
      await deleteEntrySeries(id, "future", "Recorrência interrompida.");
      return;
    }
    if (result !== true) return; // cancelou
  } else if (!confirm("Repetir esse lançamento todo mês pelos próximos 12 meses?")) {
    return;
  }

  try {
    const res = await fetch(`${API}/entries/${id}/repeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ months: 11 }),
    });
    if (!res.ok) throw new Error("Erro ao repetir lançamento");
    await loadEntries();
  } catch (err) {
    console.error(err);
    alert("Não foi possível repetir o lançamento. Verifique se o backend está rodando.");
  }
}

async function installmentEntry(id, alreadyInstallment) {
  if (alreadyInstallment) {
    const confirmed = await askConfirm(
      "Cancelar parcelamento?",
      "Isso apaga esta parcela e todas as parcelas futuras dessa compra (as que já venceram no passado continuam no histórico).",
      "Cancelar parcelas futuras"
    );
    if (!confirmed) return;
    await deleteEntrySeries(id, "future", "Parcelamento cancelado.");
    return;
  }

  const input = prompt("Em quantas parcelas mensais? O valor atual da linha será dividido entre elas (2 a 60).", "2");
  if (input === null) return;

  const installments = parseInt(input, 10);
  if (!Number.isInteger(installments) || installments < 2 || installments > 60) {
    alert("Informe um número de parcelas entre 2 e 60.");
    return;
  }

  try {
    const res = await fetch(`${API}/entries/${id}/installments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installments }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert((data.errors && data.errors[0]) || "Não foi possível parcelar o lançamento.");
      return;
    }
    await loadEntries();
  } catch (err) {
    console.error(err);
    alert("Não foi possível parcelar o lançamento. Verifique se o backend está rodando.");
  }
}

// Apaga um grupo inteiro de recorrência/parcelamento a partir de um
// lançamento (scope "future" mantém as ocorrências passadas, "all" apaga
// tudo). Usado pelas ações em massa dos botões 🔁 e 💳.
async function deleteEntrySeries(id, scope, successMessage) {
  try {
    const res = await fetch(`${API}/entries/${id}/series?scope=${scope}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      alert((data.errors && data.errors[0]) || "Não foi possível concluir a ação.");
      return;
    }
    await loadEntries();
  } catch (err) {
    console.error(err);
    alert("Não foi possível concluir a ação. Verifique se o backend está rodando.");
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
    monthlySeriesCache = data.monthly;
    renderStats(data);
    renderMonthlyChart(data.monthly);
    renderYearlyComparison(data.monthly);
    renderCategoryChart(data.by_category);
    renderMonthCompare();
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
}

function monthLabel(monthKey) {
  const [year, month] = monthKey.split("-");
  return `${month}/${year.slice(2)}`;
}

// Compara o mês selecionado nas abas com o mês anterior (o anterior
// cronologicamente entre os que têm lançamentos, não necessariamente o mês
// civil seguido). Ganhos/economia: subir é bom. Gastos: subir é ruim.
function renderMonthCompare() {
  el.monthCompare.innerHTML = "";
  if (!activeMonth || monthlySeriesCache.length === 0) return;

  const idx = monthlySeriesCache.findIndex((m) => m.month === activeMonth);
  if (idx === -1) return;

  const current = monthlySeriesCache[idx];
  const previous = idx > 0 ? monthlySeriesCache[idx - 1] : null;

  if (!previous) {
    const note = document.createElement("span");
    note.className = "month-compare-item month-compare-label";
    note.textContent = "Primeiro mês com lançamentos — ainda sem comparação.";
    el.monthCompare.appendChild(note);
    return;
  }

  const previousLabel = monthLabel(previous.month);
  el.monthCompare.appendChild(
    buildCompareItem("Ganhos", current.ganhos, previous.ganhos, false, previousLabel)
  );
  el.monthCompare.appendChild(
    buildCompareItem("Gastos", current.gastos, previous.gastos, true, previousLabel)
  );
  el.monthCompare.appendChild(
    buildCompareItem("Economia", current.economia, previous.economia, false, previousLabel)
  );
}

function buildCompareItem(label, current, previous, higherIsBad, previousLabel) {
  const item = document.createElement("span");
  item.className = "month-compare-item";

  const labelSpan = document.createElement("span");
  labelSpan.className = "month-compare-label";
  labelSpan.textContent = `${label}`;
  item.appendChild(labelSpan);

  const deltaSpan = document.createElement("span");
  deltaSpan.className = "month-compare-delta";

  if (previous === 0) {
    deltaSpan.classList.add("is-neutral");
    deltaSpan.textContent = current === 0 ? "—" : `novo vs. ${previousLabel}`;
  } else {
    const pct = Math.round(((current - previous) / Math.abs(previous)) * 100);
    const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "•";
    const goingUp = pct > 0;
    const isGood = pct === 0 ? null : higherIsBad ? !goingUp : goingUp;
    deltaSpan.classList.add(isGood === null ? "is-neutral" : isGood ? "is-good" : "is-bad");
    deltaSpan.textContent = `${arrow} ${Math.abs(pct)}% vs. ${previousLabel}`;
  }

  item.appendChild(deltaSpan);
  return item;
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
          type: "bar",
          label: "Gastos",
          data: gastosNegativos,
          backgroundColor: "rgba(255,92,100,0.7)",
          borderRadius: 4,
          order: 2,
          stack: "fluxo",
        },
        {
          type: "line",
          label: "Saldo acumulado",
          data: saldoAcumulado,
          borderColor: "#5B82FF",
          backgroundColor: "#5B82FF",
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: "#5B82FF",
          borderWidth: 2,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: { color: "#9BAAA2", font: { family: "Inter", size: 11.5 } },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(Math.abs(ctx.parsed.y))}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#9BAAA2", font: { family: "IBM Plex Mono", size: 11 } },
          grid: { display: false },
        },
        y: {
          ticks: {
            color: "#9BAAA2",
            font: { family: "IBM Plex Mono", size: 10.5 },
            callback: (v) => formatCurrency(Math.abs(v)),
          },
          grid: {
            color: (ctx) => (ctx.tick.value === 0 ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.06)"),
          },
        },
      },
    },
  });
}

// Agrega a série mensal (que já cobre todos os anos) por ano, pra dar uma
// visão "ano a ano" — só aparece quando há dados em mais de um ano, senão
// seria uma barra só e não diria nada de novo.
function renderYearlyComparison(monthly) {
  const byYear = new Map(); // "AAAA" -> { ganhos, gastos }
  for (const m of monthly) {
    const year = m.month.slice(0, 4);
    const acc = byYear.get(year) || { ganhos: 0, gastos: 0 };
    acc.ganhos += m.ganhos;
    acc.gastos += m.gastos;
    byYear.set(year, acc);
  }

  const years = Array.from(byYear.keys()).sort();

  if (years.length <= 1) {
    el.yearlyCard.hidden = true;
    if (yearlyChart) {
      yearlyChart.destroy();
      yearlyChart = null;
    }
    return;
  }

  el.yearlyCard.hidden = false;

  const ganhos = years.map((y) => round2(byYear.get(y).ganhos));
  const gastos = years.map((y) => round2(byYear.get(y).gastos));
  const saldos = years.map((y) => round2(byYear.get(y).ganhos - byYear.get(y).gastos));

  if (yearlyChart) yearlyChart.destroy();

  yearlyChart = new Chart(el.yearlyChartCanvas, {
    type: "bar",
    data: {
      labels: years,
      datasets: [
        { label: "Ganhos", data: ganhos, backgroundColor: "rgba(34,195,130,0.7)", borderRadius: 4 },
        { label: "Gastos", data: gastos, backgroundColor: "rgba(255,92,100,0.7)", borderRadius: 4 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#9BAAA2", font: { family: "Inter", size: 11.5 } } },
        tooltip: {
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}` },
        },
      },
      scales: {
        x: {
          ticks: { color: "#9BAAA2", font: { family: "IBM Plex Mono", size: 12 } },
          grid: { display: false },
        },
        y: {
          ticks: {
            color: "#9BAAA2",
            font: { family: "IBM Plex Mono", size: 10.5 },
            callback: (v) => formatCurrency(v),
          },
          grid: { color: "rgba(255,255,255,0.06)" },
        },
      },
    },
  });

  el.yearlyTable.innerHTML = `
    <thead>
      <tr><th>Ano</th><th>Ganhos</th><th>Gastos</th><th>Saldo do ano</th></tr>
    </thead>
    <tbody>
      ${years
        .map((y, i) => `
          <tr>
            <td>${escapeHtml(y)}</td>
            <td>${escapeHtml(formatCurrency(ganhos[i]))}</td>
            <td>${escapeHtml(formatCurrency(gastos[i]))}</td>
            <td class="${saldos[i] >= 0 ? "is-positive" : "is-negative"}">${escapeHtml(formatCurrency(saldos[i]))}</td>
          </tr>
        `)
        .join("")}
    </tbody>
  `;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

const DONUT_COLORS = [
  "#F2B84E", "#FF5C64", "#5B82FF", "#B48CFF", "#4DB8E8",
  "#F08AAB", "#E0913D", "#8C7AE6", "#7A93E8", "#E0648B",
];

function renderCategoryChart(byCategory) {
  const ctx = document.getElementById("category-chart");
  el.categoryEmpty.hidden = byCategory.length > 0;
  document.getElementById("category-chart").style.display =
    byCategory.length > 0 ? "block" : "none";

  if (categoryChart) categoryChart.destroy();
  if (byCategory.length === 0) return;

  categoryChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: byCategory.map((c) => c.category),
      datasets: [
        {
          data: byCategory.map((c) => c.amount),
          backgroundColor: byCategory.map((_, i) => DONUT_COLORS[i % DONUT_COLORS.length]),
          borderColor: "#151923",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: "#9BAAA2",
            font: { family: "Inter", size: 10.5 },
            boxWidth: 10,
            padding: 10,
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${formatCurrency(ctx.parsed)}`,
          },
        },
      },
    },
  });
}

// ----------------------------------------------------------------------------
// Light mode / dark mode
// ----------------------------------------------------------------------------

const THEME_KEY = "planner-theme";

function applyTheme(theme) {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
    el.themeToggleBtn.textContent = "☀️";
    el.themeToggleBtn.title = "Mudar para tema escuro";
  } else {
    document.documentElement.removeAttribute("data-theme");
    el.themeToggleBtn.textContent = "🌙";
    el.themeToggleBtn.title = "Mudar para tema claro";
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  const next = current === "light" ? "dark" : "light";
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (err) {
    // navegação privada ou storage bloqueado — segue sem persistir
  }
  applyTheme(next);
}

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch (err) {
    saved = null;
  }
  const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  applyTheme(saved || (prefersLight ? "light" : "dark"));
  el.themeToggleBtn.addEventListener("click", toggleTheme);
}

// ----------------------------------------------------------------------------
// Atalhos de teclado
// ----------------------------------------------------------------------------

function toggleShortcutsModal(forceOpen) {
  const shouldOpen = forceOpen !== undefined ? forceOpen : el.shortcutsOverlay.hidden;
  el.shortcutsOverlay.hidden = !shouldOpen;
}

function closeOpenPanels() {
  let closedSomething = false;
  if (!el.shortcutsOverlay.hidden) {
    el.shortcutsOverlay.hidden = true;
    closedSomething = true;
  }
  if (!el.confirmOverlay.hidden) {
    closeConfirm(false);
    closedSomething = true;
  }
  if (!el.goalAddForm.hidden) {
    el.goalAddForm.hidden = true;
    el.goalAddForm.reset();
    closedSomething = true;
  }
  if (!el.budgetAddForm.hidden) {
    el.budgetAddForm.hidden = true;
    el.budgetAddForm.reset();
    closedSomething = true;
  }
  if (!el.categoriesPanel.hidden) {
    toggleCategoriesPanel();
    closedSomething = true;
  }
  if (document.activeElement === el.ledgerSearch) {
    el.ledgerSearch.blur();
  }
  return closedSomething;
}

function switchToAdjacentMonth(direction) {
  const tabs = Array.from(el.monthTabs.querySelectorAll(".month-tab"));
  if (tabs.length === 0) return;
  const idx = tabs.findIndex((t) => t.dataset.month === activeMonth);
  const nextIdx = idx === -1 ? 0 : idx + direction;
  if (nextIdx < 0 || nextIdx >= tabs.length) return;
  tabs[nextIdx].click();
}

function initShortcuts() {
  el.shortcutsBtn.addEventListener("click", () => toggleShortcutsModal());
  el.shortcutsCloseBtn.addEventListener("click", () => toggleShortcutsModal(false));
  el.shortcutsOverlay.addEventListener("click", (e) => {
    if (e.target === el.shortcutsOverlay) toggleShortcutsModal(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const target = event.target;
    const isTyping =
      target &&
      (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA");

    if (event.key === "Escape") {
      closeOpenPanels();
      return;
    }

    if (isTyping) return; // não intercepta digitação normal em campos

    switch (event.key) {
      case "n":
      case "N":
        event.preventDefault();
        createBlankRow();
        break;
      case "/":
        event.preventDefault();
        el.ledgerSearch.focus();
        break;
      case "g":
      case "G":
        event.preventDefault();
        el.addGoalBtn.click();
        break;
      case "b":
      case "B":
        event.preventDefault();
        el.addBudgetBtn.click();
        break;
      case "t":
      case "T":
        event.preventDefault();
        toggleTheme();
        break;
      case "ArrowLeft":
        event.preventDefault();
        switchToAdjacentMonth(-1);
        break;
      case "ArrowRight":
        event.preventDefault();
        switchToAdjacentMonth(1);
        break;
      case "?":
        event.preventDefault();
        toggleShortcutsModal();
        break;
      default:
        break;
    }
  });
}

// ----------------------------------------------------------------------------
// Exportar CSV / PDF
// ----------------------------------------------------------------------------

// Devolve exatamente as linhas visíveis no momento (mês ativo + busca),
// na mesma ordem da tabela, já com o saldo corrente calculado.
function currentVisibleEntries() {
  const withBalance = entriesWithRunningBalance();
  let visible = activeMonth
    ? withBalance.filter(({ entry }) => monthKeyOf(entry) === activeMonth)
    : [];
  if (searchQuery) {
    visible = visible.filter(({ entry }) =>
      entry.description.toLowerCase().includes(searchQuery) ||
      entry.category.toLowerCase().includes(searchQuery)
    );
  }
  return visible;
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[";\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportCsv() {
  const visible = currentVisibleEntries();
  if (visible.length === 0) {
    alert("Não há lançamentos para exportar neste mês.");
    return;
  }

  const header = ["Data", "Descrição", "Categoria", "Tipo", "Valor", "Saldo"];
  const lines = [header.map(csvEscape).join(";")];

  for (const { entry, balance } of visible) {
    lines.push(
      [
        formatDateDisplay(entry.date),
        entry.description,
        entry.category,
        entry.type === "ganho" ? "Ganho" : "Gasto",
        entry.amount.toFixed(2).replace(".", ","),
        balance.toFixed(2).replace(".", ","),
      ]
        .map(csvEscape)
        .join(";")
    );
  }

  // BOM no início para o Excel reconhecer UTF-8 corretamente
  const csvContent = "\uFEFF" + lines.join("\r\n");
  const filename = `planner-${activeMonth || "lancamentos"}.csv`;
  downloadBlob(csvContent, filename, "text/csv;charset=utf-8");
}

function exportPdf() {
  const visible = currentVisibleEntries();
  if (visible.length === 0) {
    alert("Não há lançamentos para exportar neste mês.");
    return;
  }

  const monthTitle = activeMonth ? monthLabel(activeMonth) : "";
  const rowsHtml = visible
    .map(({ entry, balance }) => {
      const tipoLabel = entry.type === "ganho" ? "Ganho" : "Gasto";
      const amountColor = entry.type === "ganho" ? "#1a8f5a" : "#c23b41";
      return `<tr>
        <td>${escapeHtml(formatDateDisplay(entry.date))}</td>
        <td>${escapeHtml(entry.description)}</td>
        <td>${escapeHtml(entry.category)}</td>
        <td>${tipoLabel}</td>
        <td style="text-align:right;color:${amountColor}">${escapeHtml(formatCurrency(entry.amount))}</td>
        <td style="text-align:right">${escapeHtml(formatCurrency(balance))}</td>
      </tr>`;
    })
    .join("");

  const totalGanhos = visible
    .filter(({ entry }) => entry.type === "ganho")
    .reduce((sum, { entry }) => sum + entry.amount, 0);
  const totalGastos = visible
    .filter(({ entry }) => entry.type === "gasto")
    .reduce((sum, { entry }) => sum + entry.amount, 0);

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Não foi possível abrir a janela de exportação. Verifique o bloqueador de pop-ups.");
    return;
  }

  printWindow.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Planner — ${escapeHtml(monthTitle)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #1D2019; padding: 32px; }
  h1 { font-size: 20px; margin-bottom: 2px; }
  p.subtitle { color: #666; margin-top: 0; font-size: 12.5px; }
  table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 12px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #ddd; text-align: left; }
  th { text-transform: uppercase; font-size: 10.5px; letter-spacing: 0.05em; color: #555; border-bottom: 2px solid #999; }
  .totals { margin-top: 18px; font-size: 13px; }
  .totals span { margin-right: 24px; }
  @media print { body { padding: 12px; } }
</style>
</head>
<body>
  <h1>Planner — Lançamentos</h1>
  <p class="subtitle">${escapeHtml(monthTitle ? `Mês: ${monthTitle}` : "")}${searchQuery ? ` · filtro: "${escapeHtml(searchQuery)}"` : ""}</p>
  <table>
    <thead>
      <tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Tipo</th><th style="text-align:right">Valor</th><th style="text-align:right">Saldo</th></tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="totals">
    <span><strong>Ganhos:</strong> ${escapeHtml(formatCurrency(totalGanhos))}</span>
    <span><strong>Gastos:</strong> ${escapeHtml(formatCurrency(totalGastos))}</span>
    <span><strong>Saldo do período:</strong> ${escapeHtml(formatCurrency(totalGanhos - totalGastos))}</span>
  </div>
</body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
  // pequeno atraso pra garantir que o conteúdo terminou de renderizar
  // antes de abrir o diálogo de impressão (usar "Salvar como PDF")
  setTimeout(() => {
    try {
      printWindow.print();
    } catch (err) {
      // janela fechada pelo usuário antes do timeout
    }
  }, 300);
}

// ----------------------------------------------------------------------------
// Segurança dos dados — backup automático, exportar/importar tudo
// ----------------------------------------------------------------------------

let confirmResolver = null;

// ----------------------------------------------------------------------------
// Desfazer exclusões individuais
// ----------------------------------------------------------------------------
// Em vez de um confirm() bloqueante a cada exclusão, a linha/card some da
// tela na hora e um toast com "Desfazer" fica visível por alguns segundos.
// Só quando o tempo esgota (ou uma nova exclusão substitui essa) é que a
// chamada DELETE de verdade é feita — clicar em "Desfazer" só reexibe o
// elemento, sem nunca ter tocado no servidor.

const UNDO_DELAY_MS = 6000;
let pendingUndo = null;

function pendingDeleteUI(element, message, commitFn) {
  // se já existe uma exclusão aguardando, ela é efetivada agora, antes de
  // começar a próxima — só uma janela de "desfazer" por vez
  if (pendingUndo) pendingUndo.commit();

  element.classList.add("is-pending-delete");
  el.undoToastMessage.textContent = message;
  el.undoToast.hidden = false;

  const entry = {};
  entry.commit = () => {
    clearTimeout(entry.timeoutId);
    el.undoToast.hidden = true;
    pendingUndo = null;
    commitFn();
  };
  entry.revert = () => {
    clearTimeout(entry.timeoutId);
    element.classList.remove("is-pending-delete");
    el.undoToast.hidden = true;
    pendingUndo = null;
  };
  entry.timeoutId = setTimeout(entry.commit, UNDO_DELAY_MS);

  pendingUndo = entry;
}

function handleUndoClick() {
  if (pendingUndo) pendingUndo.revert();
}

// Modal de confirmação genérico, usado pelas ações destrutivas (importar,
// que substitui todos os dados; restaurar, que sobrescreve o banco atual;
// parar recorrências/parcelamentos). `opts` aceita uma string (vira só o
// texto do botão de confirmar) ou { confirmLabel, secondaryLabel } quando a
// ação tem uma segunda alternativa não-destrutiva (ex: "gerar meses que
// faltam" vs. "parar recorrência"). Devolve true (confirmou), false
// (cancelou) ou "secondary" (escolheu a ação alternativa).
function askConfirm(title, message, opts = "Confirmar") {
  const { confirmLabel = "Confirmar", secondaryLabel = null } =
    typeof opts === "string" ? { confirmLabel: opts } : opts;

  return new Promise((resolve) => {
    confirmResolver = resolve;
    el.confirmTitle.textContent = title;
    el.confirmMessage.textContent = message;
    el.confirmOkBtn.textContent = confirmLabel;
    if (secondaryLabel) {
      el.confirmSecondaryBtn.textContent = secondaryLabel;
      el.confirmSecondaryBtn.hidden = false;
    } else {
      el.confirmSecondaryBtn.hidden = true;
    }
    el.confirmOverlay.hidden = false;
    el.confirmOkBtn.focus();
  });
}

function closeConfirm(result) {
  el.confirmOverlay.hidden = true;
  const resolve = confirmResolver;
  confirmResolver = null;
  if (resolve) resolve(result);
}

function initDataSafety() {
  el.confirmOkBtn.addEventListener("click", () => closeConfirm(true));
  el.confirmSecondaryBtn.addEventListener("click", () => closeConfirm("secondary"));
  el.confirmCancelBtn.addEventListener("click", () => closeConfirm(false));
  el.confirmCloseBtn.addEventListener("click", () => closeConfirm(false));
  el.confirmOverlay.addEventListener("click", (e) => {
    if (e.target === el.confirmOverlay) closeConfirm(false);
  });

  el.exportDataBtn.addEventListener("click", exportAllData);
  el.backupNowBtn.addEventListener("click", createBackupNow);
  el.importDataBtn.addEventListener("click", () => el.importFileInput.click());
  el.importFileInput.addEventListener("change", handleImportFileSelected);
  el.undoToastBtn.addEventListener("click", handleUndoClick);
  el.offsiteBannerAction.addEventListener("click", exportAllData);
}

// Baixa um JSON com todos os lançamentos, categorias, metas, contribuições
// e orçamentos — o mesmo arquivo pode ser usado depois em "Importar backup".
async function exportAllData() {
  try {
    const res = await fetch(`${API}/export`);
    if (!res.ok) throw new Error("Falha ao exportar");
    const data = await res.json();
    const filename = `planner-export-${new Date().toISOString().slice(0, 10)}.json`;
    downloadBlob(JSON.stringify(data, null, 2), filename, "application/json");
    loadOffsiteStatus();
  } catch (err) {
    console.error("Falha ao exportar dados", err);
    alert("Não foi possível exportar os dados. Tente novamente.");
  }
}

async function createBackupNow() {
  el.backupNowBtn.disabled = true;
  try {
    const res = await fetch(`${API}/backups`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      alert((data.error) || "Não foi possível criar o backup.");
      return;
    }
    await loadBackups();
  } catch (err) {
    console.error("Falha ao criar backup", err);
    alert("Não foi possível criar o backup. Tente novamente.");
  } finally {
    el.backupNowBtn.disabled = false;
  }
}

async function handleImportFileSelected(event) {
  const file = event.target.files[0];
  event.target.value = ""; // permite selecionar o mesmo arquivo de novo depois
  if (!file) return;

  let payload;
  try {
    const text = await file.text();
    payload = JSON.parse(text);
  } catch (err) {
    alert("Esse arquivo não parece ser um JSON válido exportado pelo Planner.");
    return;
  }

  const confirmed = await askConfirm(
    "Importar backup?",
    "Isso substitui TODOS os dados atuais (lançamentos, categorias, metas e orçamentos) " +
      "pelo conteúdo do arquivo selecionado. Um backup de segurança do estado atual é " +
      "criado automaticamente antes, então dá pra desfazer restaurando esse backup depois.",
    "Importar e substituir"
  );
  if (!confirmed) return;

  try {
    const res = await fetch(`${API}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      alert((data.errors && data.errors.join("\n")) || "Não foi possível importar o arquivo.");
      return;
    }

    // recarrega tudo do zero, já que os dados foram totalmente substituídos
    await Promise.all([loadCategories().then(loadEntries), loadGoals(), loadBudgets(), loadBackups()]);
    alert("Dados importados com sucesso.");
  } catch (err) {
    console.error("Falha ao importar dados", err);
    alert("Não foi possível importar o arquivo. Tente novamente.");
  }
}

async function loadBackups() {
  try {
    const res = await fetch(`${API}/backups`);
    const backups = await res.json();
    renderBackups(backups);
  } catch (err) {
    console.error("Falha ao carregar backups", err);
  }
  loadOffsiteStatus();
}

const OFFSITE_REMINDER_DAYS = 7;

async function loadOffsiteStatus() {
  try {
    const res = await fetch(`${API}/backups/status`);
    const status = await res.json();
    renderOffsiteBanner(status);
  } catch (err) {
    console.error("Falha ao carregar status de backup externo", err);
  }
}

function renderOffsiteBanner(status) {
  const days = status.days_since;
  const needsReminder = days === null || days === undefined || days >= OFFSITE_REMINDER_DAYS;

  if (!needsReminder) {
    el.offsiteBanner.hidden = true;
    return;
  }

  el.offsiteBannerText.textContent =
    status.last_offsite_at === null
      ? "Você ainda não baixou nenhuma cópia dos seus dados. Os backups automáticos ficam neste computador — exporte uma cópia e guarde em outro lugar (nuvem, pendrive) pra se proteger de perda do disco."
      : `Já se passaram ${Math.floor(days)} dias desde a última vez que você baixou uma cópia dos seus dados. Os backups automáticos ficam neste computador — considere exportar uma cópia e guardar em outro lugar.`;
  el.offsiteBanner.hidden = false;
}

const backupReasonLabels = {
  auto: "Automático",
  manual: "Manual",
  "pre-import": "Antes de importar",
  "pre-restore": "Antes de restaurar",
};

function parseBackupFilename(filename) {
  // formato: planner-{reason}-{YYYYMMDD}-{HHMMSS}.db
  const match = /^planner-([a-z-]+)-(\d{8})-(\d{6})\.db$/.exec(filename);
  if (!match) return { reason: "manual", label: filename };
  const [, reason] = match;
  return { reason, label: backupReasonLabels[reason] || reason };
}

function formatBackupDate(isoString) {
  const date = new Date(`${isoString}Z`); // created_at vem em UTC "naive"
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function renderBackups(backups) {
  el.backupsList.innerHTML = "";
  el.backupsEmpty.hidden = backups.length > 0;

  for (const backup of backups) {
    const { reason, label } = parseBackupFilename(backup.filename);

    const item = document.createElement("div");
    item.className = "backup-item";
    item.innerHTML = `
      <div class="backup-item-info">
        <span class="backup-item-date">${escapeHtml(formatBackupDate(backup.created_at))}</span>
        <span class="backup-item-meta">
          <span class="backup-reason-badge backup-reason-badge--${escapeHtml(reason)}">${escapeHtml(label)}</span>
          <span>${escapeHtml(formatBytes(backup.size_bytes))}</span>
        </span>
      </div>
      <div class="backup-item-actions">
        <button class="btn btn--small backup-download-btn" type="button">⬇ Baixar</button>
        <button class="btn btn--small btn--danger backup-restore-btn" type="button">↺ Restaurar</button>
      </div>
    `;

    item.querySelector(".backup-download-btn").addEventListener("click", () => {
      window.location.href = `${API}/backups/${encodeURIComponent(backup.filename)}/download`;
      setTimeout(loadOffsiteStatus, 1500);
    });

    item.querySelector(".backup-restore-btn").addEventListener("click", async () => {
      const confirmed = await askConfirm(
        "Restaurar este backup?",
        `Isso substitui TODOS os dados atuais pelo conteúdo do backup de ${formatBackupDate(backup.created_at)}. ` +
          "Um backup de segurança do estado atual é criado automaticamente antes.",
        "Restaurar"
      );
      if (!confirmed) return;

      try {
        const res = await fetch(`${API}/backups/${encodeURIComponent(backup.filename)}/restore`, {
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok) {
          alert((data.error) || "Não foi possível restaurar esse backup.");
          return;
        }
        await Promise.all([loadCategories().then(loadEntries), loadGoals(), loadBudgets(), loadBackups()]);
        alert("Backup restaurado com sucesso.");
      } catch (err) {
        console.error("Falha ao restaurar backup", err);
        alert("Não foi possível restaurar esse backup. Tente novamente.");
      }
    });

    el.backupsList.appendChild(item);
  }
}

// ----------------------------------------------------------------------------
// Utils
// ----------------------------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
