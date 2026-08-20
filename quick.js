// =====================================================================
// CARGA RÁPIDA — versión mínima para agregar movimientos en pocos toques
// =====================================================================

const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

const qs = { section: null, token: null, accounts: [], categories: [], type: "gasto" };

function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function sessionKey(section) { return `finanzas_session_${section}`; }

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function showScreen(id) {
  ["q-screen-pick", "q-screen-login", "q-screen-form"].forEach((s) => {
    $("#" + s).classList.toggle("hidden", s !== id);
  });
}

function renderLedgerList() {
  const el = $("#q-ledger-list");
  el.innerHTML = "";
  Object.entries(CONFIG.SECTIONS).forEach(([key, cfg]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "quick-ledger-btn";
    btn.style.setProperty("--spine", cfg.color);
    btn.textContent = cfg.label;
    btn.addEventListener("click", () => openSection(key));
    el.appendChild(btn);
  });
}

async function openSection(section) {
  qs.section = section;
  const token = localStorage.getItem(sessionKey(section));
  if (token) {
    qs.token = token;
    const ok = await loadAccountsAndCategories();
    if (ok) { showForm(); return; }
    localStorage.removeItem(sessionKey(section));
    qs.token = null;
  }
  const cfg = CONFIG.SECTIONS[section];
  $("#q-login-title").textContent = cfg.label;
  $("#q-login-error").textContent = "";
  $("#q-login-password").value = "";
  showScreen("q-screen-login");
  setTimeout(() => $("#q-login-password").focus(), 50);
}

async function handleQuickLogin(e) {
  e.preventDefault();
  const password = $("#q-login-password").value;
  const btn = $("#q-login-form button[type=submit]");
  btn.disabled = true;
  try {
    const { data, error } = await sb.rpc("login", { p_section: qs.section, p_password: password });
    if (error || !data) {
      $("#q-login-error").textContent = "Contraseña incorrecta.";
      return;
    }
    qs.token = data;
    localStorage.setItem(sessionKey(qs.section), data);
    const ok = await loadAccountsAndCategories();
    if (ok) showForm();
  } catch (err) {
    console.error(err);
    $("#q-login-error").textContent = "No se pudo conectar.";
  } finally {
    btn.disabled = false;
  }
}

async function loadAccountsAndCategories() {
  try {
    const { data, error } = await sb.rpc("get_state", { p_token: qs.token, p_section: qs.section });
    if (error) throw error;
    qs.accounts = data.accounts || [];
    qs.categories = data.categories || [];
    return true;
  } catch (e) {
    return false;
  }
}

function showForm() {
  const cfg = CONFIG.SECTIONS[qs.section];
  $("#q-form-title").textContent = cfg.label;
  document.documentElement.style.setProperty("--spine", cfg.color);

  $("#q-account").innerHTML = qs.accounts.length
    ? qs.accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("")
    : `<option value="">Sin cuentas — creá una en el dashboard</option>`;
  refreshCategoryOptions();

  showScreen("q-screen-form");
  setTimeout(() => $("#q-amount").focus(), 50);
}

function refreshCategoryOptions() {
  const opts = qs.categories.filter((c) => c.type === qs.type)
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  $("#q-category").innerHTML = `<option value="">Categoría…</option>${opts}`;
}

function setType(type) {
  qs.type = type;
  $all(".quick-type-btn").forEach((b) => b.classList.toggle("active", b.dataset.type === type));
  refreshCategoryOptions();
}

async function handleQuickSave(e) {
  e.preventDefault();
  const amount = parseFloat($("#q-amount").value);
  const account_id = $("#q-account").value;
  const category_id = $("#q-category").value || null;
  const description = $("#q-desc").value.trim();
  if (!amount || amount <= 0 || !account_id) {
    toast("Completá monto y cuenta.");
    return;
  }
  const btn = $("#q-txn-form button[type=submit]");
  btn.disabled = true;
  try {
    const { error } = await sb.rpc("add_transaction", {
      p_token: qs.token, p_section: qs.section,
      p_account_id: account_id, p_category_id: category_id,
      p_type: qs.type, p_amount: amount, p_description: description,
      p_date: new Date().toISOString().slice(0, 10),
    });
    if (error) throw error;
    toast(qs.type === "gasto" ? "Gasto guardado." : "Ingreso guardado.");
    $("#q-amount").value = "";
    $("#q-desc").value = "";
    $("#q-amount").focus();
  } catch (err) {
    console.error(err);
    toast("No se pudo guardar.");
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  renderLedgerList();
  $("#q-login-back").addEventListener("click", () => showScreen("q-screen-pick"));
  $("#q-login-form").addEventListener("submit", handleQuickLogin);
  $("#q-form-switch").addEventListener("click", () => showScreen("q-screen-pick"));
  $all(".quick-type-btn").forEach((b) => b.addEventListener("click", () => setType(b.dataset.type)));
  $("#q-txn-form").addEventListener("submit", handleQuickSave);
});
