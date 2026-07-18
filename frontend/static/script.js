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
};

let monthlyChart = null;
let categoryChart = null;

// cache local das categorias, atualizada sempre que a lista muda
let categoriesCache = [];

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

  el.addRowBtn.addEventListener("click", () => createBlankRow());
  el.toggleCategoriesBtn.addEventListener("click", toggleCategoriesPanel);
  el.ganhoCategoryForm.addEventListener("submit", (e) => submitNewCategory(e, "ganho"));
  el.gastoCategoryForm.addEventListener("submit", (e) => submitNewCategory(e, "gasto"));
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
// Carregar e renderizar lançamentos
// ----------------------------------------------------------------------------

async function loadEntries() {
  try {
    const res = await fetch(`${API}/entries`);
    const entries = await res.json();
    renderRows(entries);
    loadSummary();
  } catch (err) {
    console.error("Falha ao carregar lançamentos", err);
  }
}

function renderRows(entries) {
  el.tbody.innerHTML = "";
  el.emptyState.hidden = entries.length > 0;

  let running = 0;
  for (const entry of entries) {
    running += entry.type === "ganho" ? entry.amount : -entry.amount;
    const row = buildRow(entry, running);
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
  const date = new Date(Number(year), Number(month) - 1, 1);
  return capitalize(
    new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" }).format(date)
  );
}

function renderMonthlyChart(monthly) {
  const ctx = document.getElementById("monthly-chart");
  const labels = monthly.map((m) => monthLabel(m.month));
  const ganhos = monthly.map((m) => m.ganhos);
  const gastos = monthly.map((m) => m.gastos);
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
          backgroundColor: "rgba(144,160,145,0.55)",
          borderRadius: 4,
          order: 2,
        },
        {
          type: "bar",
          label: "Gastos",
          data: gastos,
          backgroundColor: "rgba(173,148,130,0.55)",
          borderRadius: 4,
          order: 2,
        },
        {
          type: "line",
          label: "Saldo acumulado",
          data: saldoAcumulado,
          borderColor: "#BDB6A8",
          backgroundColor: "#BDB6A8",
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: "#BDB6A8",
          borderWidth: 2,
          order: 1,
          yAxisID: "y1",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: { color: "#9C9B96", font: { family: "Inter", size: 11.5 } },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#9C9B96", font: { family: "IBM Plex Mono", size: 11 } },
          grid: { display: false },
        },
        y: {
          ticks: {
            color: "#9C9B96",
            font: { family: "IBM Plex Mono", size: 10.5 },
            callback: (v) => formatCurrency(v),
          },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
        y1: {
          position: "right",
          grid: { display: false },
          ticks: {
            color: "#BDB6A8",
            font: { family: "IBM Plex Mono", size: 10.5 },
            callback: (v) => formatCurrency(v),
          },
        },
      },
    },
  });
}

const DONUT_COLORS = [
  "#90A091", "#AD9482", "#BDB6A8", "#8C9BA6", "#A79BAE",
  "#B0A688", "#87A3A3", "#A38878", "#94A387", "#A387A0",
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
          borderColor: "#202125",
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
            color: "#9C9B96",
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
// Utils
// ----------------------------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
