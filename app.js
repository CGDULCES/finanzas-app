// =====================================================================
// FINANZAS — lógica de la app
// =====================================================================

const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

const fmt = new Intl.NumberFormat(CONFIG.LOCALE, {
  style: "currency",
  currency: CONFIG.CURRENCY,
  maximumFractionDigits: 0,
});

const state = {
  section: null,
  token: null,
  data: { accounts: [], categories: [], transactions: [], goals: [] },
  charts: {},
};

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------

function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

function accountBalance(acc) {
  const moves = state.data.transactions.filter((t) => t.account_id === acc.id);
  const delta = moves.reduce((sum, t) => sum + (t.type === "ingreso" ? Number(t.amount) : -Number(t.amount)), 0);
  return Number(acc.initial_balance) + delta;
}

function totalPatrimonio() {
  return state.data.accounts.reduce((sum, a) => sum + accountBalance(a), 0);
}

function categoryById(id) {
  return state.data.categories.find((c) => c.id === id);
}

function accountById(id) {
  return state.data.accounts.find((a) => a.id === id);
}

// ---------------------------------------------------------------------
// Sesión / navegación
// ---------------------------------------------------------------------

function sessionKey(section) { return `finanzas_session_${section}`; }

async function tryResumeSession(section) {
  const token = localStorage.getItem(sessionKey(section));
  if (!token) return false;
  state.token = token;
  state.section = section;
  try {
    await loadState();
    return true;
  } catch (e) {
    localStorage.removeItem(sessionKey(section));
    state.token = null;
    state.section = null;
    return false;
  }
}

function openLogin(section) {
  const cfg = CONFIG.SECTIONS[section];
  $("#login-title").textContent = cfg.label;
  $("#login-error").textContent = "";
  $("#login-password").value = "";
  $("#login-box").style.borderTopColor = cfg.color;
  $("#login-overlay").dataset.section = section;
  $("#login-overlay").classList.remove("hidden");
  setTimeout(() => $("#login-password").focus(), 50);
}

function closeLogin() {
  $("#login-overlay").classList.add("hidden");
}

async function handleLogin(e) {
  e.preventDefault();
  const section = $("#login-overlay").dataset.section;
  const password = $("#login-password").value;
  const btn = $("#login-submit");
  btn.disabled = true;
  $("#login-error").textContent = "";
  try {
    const { data, error } = await sb.rpc("login", { p_section: section, p_password: password });
    if (error || !data) {
      $("#login-error").textContent = "Contraseña incorrecta.";
      return;
    }
    state.token = data;
    state.section = section;
    localStorage.setItem(sessionKey(section), data);
    await loadState();
    closeLogin();
    showApp();
  } catch (err) {
    $("#login-error").textContent = "No se pudo conectar. Revisá la configuración.";
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

async function loadState() {
  const { data, error } = await sb.rpc("get_state", { p_token: state.token, p_section: state.section });
  if (error) throw error;
  state.data = {
    accounts: data.accounts || [],
    categories: data.categories || [],
    transactions: data.transactions || [],
    goals: data.goals || [],
  };
}

async function logout() {
  if (state.token) {
    try { await sb.rpc("logout", { p_token: state.token }); } catch (e) { /* noop */ }
    localStorage.removeItem(sessionKey(state.section));
  }
  state.token = null;
  state.section = null;
  $("#screen-app").classList.add("hidden");
  $("#screen-landing").classList.remove("hidden");
}

// ---------------------------------------------------------------------
// Render: shell + tabs
// ---------------------------------------------------------------------

function showApp() {
  const cfg = CONFIG.SECTIONS[state.section];
  $("#screen-landing").classList.add("hidden");
  $("#screen-app").classList.remove("hidden");
  $("#app-title").textContent = cfg.label;
  document.documentElement.style.setProperty("--spine", cfg.color);

  $("#tab-metas").classList.toggle("hidden", state.section !== "compartido");

  renderAll();
  switchTab("dashboard");
}

function switchTab(tab) {
  $all(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  $all(".panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${tab}`));
  if (tab === "reportes") renderCharts();
}

function renderAll() {
  renderDashboard();
  renderMovimientos();
  renderCuentas();
  renderCategorySelects();
  renderCategoriesList();
  if (state.section === "compartido") renderMetas();
}

// ---------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------

function renderDashboard() {
  const total = totalPatrimonio();
  $("#app-total").textContent = `Patrimonio total: ${fmt.format(total)}`;

  const cardsEl = $("#dashboard-cards");
  cardsEl.innerHTML = "";

  const totalCard = document.createElement("div");
  totalCard.className = "stat-card";
  totalCard.innerHTML = `<p class="stat-label">Patrimonio total</p><p class="stat-value">${fmt.format(total)}</p><p class="stat-sub">${state.data.accounts.length} cuenta(s)</p>`;
  cardsEl.appendChild(totalCard);

  state.data.accounts.forEach((acc) => {
    const bal = accountBalance(acc);
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `<p class="stat-label">${acc.name} · ${labelForType(acc.type)}</p><p class="stat-value">${fmt.format(bal)}</p>`;
    cardsEl.appendChild(card);
  });

  const recentEl = $("#dashboard-recent");
  const recent = state.data.transactions.slice(0, 6);
  recentEl.innerHTML = recent.length
    ? recent.map(rowHtmlCompact).join("")
    : `<p class="empty-state">Todavía no cargaste movimientos.</p>`;
}

function labelForType(type) {
  return { efectivo: "Efectivo", banco: "Banco", ahorro: "Ahorro" }[type] || type;
}

function rowHtmlCompact(t) {
  const acc = accountById(t.account_id);
  const cat = categoryById(t.category_id);
  const sign = t.type === "ingreso" ? "+" : "−";
  return `<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line);font-size:14px;">
    <span>${escapeHtml(t.description || cat?.name || "Movimiento")} <span style="color:var(--ink-soft)">· ${acc?.name || ""}</span></span>
    <span class="amount ${t.type}">${sign} ${fmt.format(t.amount)}</span>
  </div>`;
}

// ---------------------------------------------------------------------
// Movimientos
// ---------------------------------------------------------------------

function renderMovimientos() {
  const tbody = $("#txn-tbody");
  if (!state.data.transactions.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No hay movimientos todavía. Agregá el primero arriba.</td></tr>`;
    return;
  }
  tbody.innerHTML = state.data.transactions.map((t) => {
    const acc = accountById(t.account_id);
    const cat = categoryById(t.category_id);
    const sign = t.type === "ingreso" ? "+" : "−";
    return `<tr>
      <td>${formatDate(t.txn_date)}</td>
      <td>${escapeHtml(t.description || "—")}</td>
      <td>${cat ? `<span class="chip" style="background:${cat.color}">${escapeHtml(cat.name)}</span>` : "—"}</td>
      <td>${acc ? escapeHtml(acc.name) : "—"}</td>
      <td class="amount ${t.type}">${sign} ${fmt.format(t.amount)}</td>
      <td class="row-actions"><button data-del-txn="${t.id}">Eliminar</button></td>
    </tr>`;
  }).join("");
}

function formatDate(d) {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString(CONFIG.LOCALE, { day: "2-digit", month: "short", year: "numeric" });
}

async function handleAddTransaction(e) {
  e.preventDefault();
  const account_id = $("#txn-account").value;
  const category_id = $("#txn-category").value || null;
  const type = $("#txn-type").value;
  const amount = parseFloat($("#txn-amount").value);
  const description = $("#txn-description").value.trim();
  const date = $("#txn-date").value || new Date().toISOString().slice(0, 10);

  if (!account_id || !amount || amount <= 0) {
    toast("Completá cuenta y monto.");
    return;
  }

  try {
    const { error } = await sb.rpc("add_transaction", {
      p_token: state.token, p_section: state.section,
      p_account_id: account_id, p_category_id: category_id,
      p_type: type, p_amount: amount, p_description: description, p_date: date,
    });
    if (error) throw error;
    await loadState();
    renderAll();
    $("#txn-form").reset();
    toast("Movimiento agregado.");
  } catch (err) {
    console.error(err);
    toast("No se pudo guardar el movimiento.");
  }
}

async function handleDeleteTransaction(id) {
  try {
    const { error } = await sb.rpc("delete_transaction", { p_token: state.token, p_section: state.section, p_transaction_id: id });
    if (error) throw error;
    await loadState();
    renderAll();
    toast("Movimiento eliminado.");
  } catch (err) {
    console.error(err);
    toast("No se pudo eliminar.");
  }
}

// ---------------------------------------------------------------------
// Cuentas
// ---------------------------------------------------------------------

function renderCuentas() {
  const el = $("#accounts-list");
  if (!state.data.accounts.length) {
    el.innerHTML = `<p class="empty-state">Todavía no cargaste cuentas.</p>`;
    return;
  }
  el.innerHTML = state.data.accounts.map((a) => `
    <div class="stat-card" style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <p class="stat-label">${labelForType(a.type)}</p>
          <p class="stat-value" style="font-size:18px;">${escapeHtml(a.name)}</p>
          <p class="stat-sub">Saldo inicial ${fmt.format(a.initial_balance)} · Saldo actual ${fmt.format(accountBalance(a))}</p>
        </div>
        <div class="row-actions"><button data-del-acc="${a.id}">Archivar</button></div>
      </div>
    </div>
  `).join("");
}

function refreshAccountNameField() {
  const type = $("#acc-type").value;
  const field = $("#acc-name-field");
  const input = $("#acc-name");
  if (type === "efectivo") {
    field.classList.add("hidden");
    input.required = false;
  } else {
    field.classList.remove("hidden");
    input.required = true;
  }
}

async function handleAddAccount(e) {
  e.preventDefault();
  const type = $("#acc-type").value;
  const name = type === "efectivo" ? "Efectivo" : $("#acc-name").value.trim();
  const initial = parseFloat($("#acc-initial").value || "0");
  if (!name) { toast("Ponele un nombre al banco."); return; }
  try {
    const { error } = await sb.rpc("add_account", { p_token: state.token, p_section: state.section, p_name: name, p_type: type, p_initial: initial });
    if (error) throw error;
    await loadState();
    renderAll();
    $("#acc-form").reset();
    refreshAccountNameField();
    toast("Cuenta agregada.");
  } catch (err) {
    console.error(err);
    toast("No se pudo agregar la cuenta.");
  }
}

async function handleDeleteAccount(id) {
  if (!confirm("¿Archivar esta cuenta? Los movimientos ya cargados se conservan.")) return;
  try {
    const { error } = await sb.rpc("delete_account", { p_token: state.token, p_section: state.section, p_account_id: id });
    if (error) throw error;
    await loadState();
    renderAll();
    toast("Cuenta archivada.");
  } catch (err) {
    console.error(err);
    toast("No se pudo archivar.");
  }
}

// ---------------------------------------------------------------------
// Categorías (selects compartidos por los formularios)
// ---------------------------------------------------------------------

function renderCategorySelects() {
  const accOptions = state.data.accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
  $("#txn-account").innerHTML = `<option value="">Cuenta…</option>${accOptions}`;

  function catOptions(type) {
    return state.data.categories.filter((c) => c.type === type)
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  }
  function refreshCategorySelect() {
    const type = $("#txn-type").value;
    $("#txn-category").innerHTML = `<option value="">Categoría…</option>${catOptions(type)}`;
  }
  $("#txn-type").onchange = refreshCategorySelect;
  refreshCategorySelect();

  $("#txn-date").value = new Date().toISOString().slice(0, 10);
}

function renderCategoriesList() {
  const el = $("#categories-list");
  if (!el) return;
  if (!state.data.categories.length) {
    el.innerHTML = `<p class="empty-state">Todavía no cargaste categorías.</p>`;
    return;
  }
  el.innerHTML = state.data.categories.map((c) => `
    <div class="chip" style="background:${c.color};display:inline-flex;align-items:center;gap:8px;margin:0 8px 8px 0;">
      ${escapeHtml(c.name)} · ${c.type === "ingreso" ? "Ingreso" : "Gasto"}
      <button data-del-cat="${c.id}" style="background:none;border:none;color:#fff;cursor:pointer;font-weight:700;padding:0;line-height:1;">×</button>
    </div>
  `).join("");
}

async function handleDeleteCategory(id) {
  try {
    const { error } = await sb.rpc("delete_category", { p_token: state.token, p_section: state.section, p_category_id: id });
    if (error) throw error;
    await loadState();
    renderAll();
    toast("Categoría eliminada.");
  } catch (err) {
    console.error(err);
    toast("No se pudo eliminar la categoría.");
  }
}

async function handleAddCategory(e) {
  e.preventDefault();
  const name = $("#cat-name").value.trim();
  const type = $("#cat-type").value;
  const color = $("#cat-color").value || "#2F5D50";
  if (!name) return;
  try {
    const { error } = await sb.rpc("add_category", { p_token: state.token, p_section: state.section, p_name: name, p_type: type, p_color: color });
    if (error) throw error;
    await loadState();
    renderAll();
    $("#cat-form").reset();
    toast("Categoría agregada.");
  } catch (err) {
    console.error(err);
    toast("No se pudo agregar la categoría.");
  }
}

// ---------------------------------------------------------------------
// Reportes
// ---------------------------------------------------------------------

function renderCharts() {
  renderCategoryChart();
  renderTrendChart();
}

function renderCategoryChart() {
  const ctx = $("#chart-category");
  const now = new Date();
  const thisMonth = state.data.transactions.filter((t) => {
    const d = new Date(t.txn_date + "T00:00:00");
    return t.type === "gasto" && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const byCat = {};
  thisMonth.forEach((t) => {
    const cat = categoryById(t.category_id);
    const key = cat ? cat.name : "Sin categoría";
    byCat[key] = (byCat[key] || 0) + Number(t.amount);
  });
  const labels = Object.keys(byCat);
  const values = Object.values(byCat);
  const colors = labels.map((l) => {
    const cat = state.data.categories.find((c) => c.name === l);
    return cat ? cat.color : "#8b9088";
  });

  if (state.charts.category) state.charts.category.destroy();
  state.charts.category = new Chart(ctx, {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
    options: {
      plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } },
      cutout: "62%",
    },
  });

  if (!labels.length) {
    $("#chart-category-empty").classList.remove("hidden");
  } else {
    $("#chart-category-empty").classList.add("hidden");
  }
}

function renderTrendChart() {
  const ctx = $("#chart-trend");
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString(CONFIG.LOCALE, { month: "short" }) });
  }
  const ingresos = months.map(() => 0);
  const gastos = months.map(() => 0);
  state.data.transactions.forEach((t) => {
    const d = new Date(t.txn_date + "T00:00:00");
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const idx = months.findIndex((m) => m.key === key);
    if (idx === -1) return;
    if (t.type === "ingreso") ingresos[idx] += Number(t.amount);
    else gastos[idx] += Number(t.amount);
  });

  if (state.charts.trend) state.charts.trend.destroy();
  state.charts.trend = new Chart(ctx, {
    type: "bar",
    data: {
      labels: months.map((m) => m.label),
      datasets: [
        { label: "Ingresos", data: ingresos, backgroundColor: "#2f5d50" },
        { label: "Gastos", data: gastos, backgroundColor: "#9c3d3d" },
      ],
    },
    options: {
      plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } },
      scales: { y: { ticks: { callback: (v) => fmt.format(v) } } },
    },
  });
}

// ---------------------------------------------------------------------
// Metas de ahorro (solo sección compartido)
// ---------------------------------------------------------------------

function renderMetas() {
  const el = $("#goals-list");
  if (!state.data.goals.length) {
    el.innerHTML = `<p class="empty-state">Todavía no definieron una meta de ahorro.</p>`;
    return;
  }
  el.innerHTML = state.data.goals.map((g) => {
    const pct = Math.min(100, Math.round((Number(g.current_amount) / Number(g.target_amount)) * 100)) || 0;
    return `<div class="goal-card">
      <div class="goal-top">
        <span class="goal-name">${escapeHtml(g.name)}</span>
        <span class="goal-amounts">${fmt.format(g.current_amount)} / ${fmt.format(g.target_amount)}</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="row-actions" style="margin-top:10px;display:flex;gap:14px;">
        <button data-goal-add="${g.id}">+ Sumar aporte</button>
        <button data-goal-del="${g.id}">Eliminar</button>
      </div>
    </div>`;
  }).join("");
}

async function handleAddGoal(e) {
  e.preventDefault();
  const name = $("#goal-name").value.trim();
  const target = parseFloat($("#goal-target").value);
  const deadline = $("#goal-deadline").value || null;
  if (!name || !target) { toast("Completá nombre y monto objetivo."); return; }
  try {
    const { error } = await sb.rpc("add_goal", { p_token: state.token, p_section: state.section, p_name: name, p_target: target, p_deadline: deadline });
    if (error) throw error;
    await loadState();
    renderMetas();
    $("#goal-form").reset();
    toast("Meta creada.");
  } catch (err) {
    console.error(err);
    toast("No se pudo crear la meta.");
  }
}

async function handleGoalAdd(id) {
  const goal = state.data.goals.find((g) => g.id === id);
  const amountStr = prompt(`¿Cuánto querés sumar a "${goal.name}"?`);
  const amount = parseFloat(amountStr);
  if (!amount || amount <= 0) return;
  const newAmount = Number(goal.current_amount) + amount;
  try {
    const { error } = await sb.rpc("update_goal_amount", { p_token: state.token, p_section: state.section, p_goal_id: id, p_new_amount: newAmount });
    if (error) throw error;
    await loadState();
    renderMetas();
    toast("Aporte sumado.");
  } catch (err) {
    console.error(err);
    toast("No se pudo actualizar la meta.");
  }
}

async function handleGoalDelete(id) {
  if (!confirm("¿Eliminar esta meta?")) return;
  try {
    const { error } = await sb.rpc("delete_goal", { p_token: state.token, p_section: state.section, p_goal_id: id });
    if (error) throw error;
    await loadState();
    renderMetas();
  } catch (err) {
    console.error(err);
  }
}

// ---------------------------------------------------------------------
// Cambiar contraseña
// ---------------------------------------------------------------------

async function handleChangePassword(e) {
  e.preventDefault();
  const current = $("#pw-current").value;
  const next = $("#pw-new").value;
  const confirmPw = $("#pw-confirm").value;
  if (next.length < 6) { toast("La nueva contraseña debe tener al menos 6 caracteres."); return; }
  if (next !== confirmPw) { toast("Las contraseñas nuevas no coinciden."); return; }

  try {
    const { data: check } = await sb.rpc("login", { p_section: state.section, p_password: current });
    if (!check) { toast("La contraseña actual no es correcta."); return; }
    const { error } = await sb.rpc("change_password", { p_token: state.token, p_section: state.section, p_new_password: next });
    if (error) throw error;
    $("#pw-form").reset();
    toast("Contraseña actualizada.");
  } catch (err) {
    console.error(err);
    toast("No se pudo cambiar la contraseña.");
  }
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  $all(".ledger-card").forEach((card) => {
    card.addEventListener("click", async () => {
      const section = card.dataset.section;
      const resumed = await tryResumeSession(section);
      if (resumed) { showApp(); return; }
      openLogin(section);
    });
  });

  $("#login-cancel").addEventListener("click", closeLogin);
  $("#login-form").addEventListener("submit", handleLogin);
  $("#logout-btn").addEventListener("click", logout);

  $all(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));

  $("#txn-form").addEventListener("submit", handleAddTransaction);
  $("#acc-form").addEventListener("submit", handleAddAccount);
  $("#acc-type").addEventListener("change", refreshAccountNameField);
  refreshAccountNameField();
  $("#cat-form").addEventListener("submit", handleAddCategory);
  $("#goal-form")?.addEventListener("submit", handleAddGoal);
  $("#pw-form").addEventListener("submit", handleChangePassword);

  document.body.addEventListener("click", (e) => {
    const delTxn = e.target.closest("[data-del-txn]");
    if (delTxn) return handleDeleteTransaction(delTxn.dataset.delTxn);
    const delAcc = e.target.closest("[data-del-acc]");
    if (delAcc) return handleDeleteAccount(delAcc.dataset.delAcc);
    const delCat = e.target.closest("[data-del-cat]");
    if (delCat) return handleDeleteCategory(delCat.dataset.delCat);
    const goalAdd = e.target.closest("[data-goal-add]");
    if (goalAdd) return handleGoalAdd(goalAdd.dataset.goalAdd);
    const goalDel = e.target.closest("[data-goal-del]");
    if (goalDel) return handleGoalDelete(goalDel.dataset.goalDel);
  });
});
