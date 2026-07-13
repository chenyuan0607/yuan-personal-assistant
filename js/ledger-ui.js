import { budgetStatus, createBackup, filterRecords, formatMoney, parseBackup, rankCategories, sortRecords, summarizeMonth, validateRecord } from "./ledger.js";

const DB_NAME = "yuan-personal-ledger";
const STORES = ["records", "settings", "categories", "templates"];
const defaults = { expense: ["餐饮", "交通", "购物", "住房", "娱乐", "健康", "其他"], income: ["工资", "奖金", "红包", "退款", "其他"] };
let records = [], settings = {}, customCategories = [], templates = [], searchQuery = "";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => { for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}

async function operation(storeName, mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode); const store = tx.objectStore(storeName); const request = action(store);
    tx.oncomplete = () => { db.close(); resolve(request?.result); }; tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

const listStore = (name) => operation(name, "readonly", (store) => store.getAll());
const putStore = (name, value) => operation(name, "readwrite", (store) => store.put(value));
const deleteStore = (name, id) => operation(name, "readwrite", (store) => store.delete(id));
async function replaceStore(name, values) { await operation(name, "readwrite", (store) => { store.clear(); for (const value of values) store.put(value); }); }
const localDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
const toast = (message) => { const el = document.querySelector("#toast"); el.textContent = message; el.hidden = false; setTimeout(() => { el.hidden = true; }, 2200); };

function categoriesFor(type) {
  return [...new Set(defaults[type].concat(customCategories.filter((item) => item.type === type && item.active).map((item) => item.name)))];
}

function updateCategories(type, selected = "") {
  const select = document.querySelector("#category");
  const names = categoriesFor(type); if (selected && !names.includes(selected)) names.push(selected);
  select.replaceChildren(...names.map((name) => new Option(name, name, false, name === selected)));
}

function renderBudget(summary, month) {
  const budget = settings[`budget:${month}`] || 0; const status = budgetStatus(summary.expenseCents, budget); const percent = budget ? Math.round(status.ratio * 100) : 0;
  document.querySelector("[data-budget-label]").textContent = budget ? formatMoney(budget) : "尚未设置";
  document.querySelector("[data-budget-spent]").textContent = `已用 ${formatMoney(summary.expenseCents)}${budget ? ` · ${percent}%` : ""}`;
  document.querySelector("[data-budget-remaining]").textContent = budget ? `${status.remainingCents >= 0 ? "剩余" : "超支"} ${formatMoney(Math.abs(status.remainingCents))}` : "设置后显示剩余金额";
  const progress = document.querySelector("[data-budget-progress]"); progress.style.width = `${Math.min(100, percent)}%`; progress.style.background = status.state === "over" ? "var(--red)" : status.state === "warning" ? "#c18b19" : "var(--green)";
  const message = document.querySelector("[data-budget-message]"); message.hidden = !budget || status.state === "normal"; message.className = `budget-message ${status.state === "over" ? "over" : ""}`; message.textContent = status.state === "over" ? `本月已超出预算 ${formatMoney(-status.remainingCents)}` : "本月预算已使用 80% 以上，请留意后续支出。";
}

function renderCategoryBars(summary) {
  const root = document.querySelector("#category-bars"); root.replaceChildren(); const ranked = rankCategories(summary.categories); const max = ranked[0]?.amountCents || 0;
  if (!ranked.length) { const p = document.createElement("p"); p.className = "empty compact"; p.textContent = "有支出后显示分类统计。"; root.append(p); return; }
  for (const item of ranked) { const row = document.createElement("div"); row.className = "category-row"; row.innerHTML = `<div class="category-label"><span></span><strong></strong></div><div class="category-track"><span></span></div>`; row.querySelector(".category-label span").textContent = item.category; row.querySelector("strong").textContent = formatMoney(item.amountCents); row.querySelector(".category-track span").style.width = `${item.amountCents / max * 100}%`; root.append(row); }
}

function renderTemplates() {
  const root = document.querySelector("#quick-templates"); root.replaceChildren();
  for (const template of templates) { const button = document.createElement("button"); button.type = "button"; button.className = "quick-template"; button.textContent = `${template.title} ${formatMoney(template.amountCents)}`; button.addEventListener("click", () => openEditor({ ...template, id: "", date: localDate(), createdAt: "" })); root.append(button); }
}

function render() {
  const month = document.querySelector("#month-filter").value; const summary = summarizeMonth(records, month); const visible = sortRecords(filterRecords(records, searchQuery)).filter((item) => item.date.startsWith(`${month}-`));
  document.querySelector("[data-expense]").textContent = formatMoney(summary.expenseCents); document.querySelector("[data-income]").textContent = formatMoney(summary.incomeCents); document.querySelector("[data-balance]").textContent = formatMoney(summary.balanceCents); document.querySelector("[data-record-count]").textContent = `${visible.length} 笔`;
  renderBudget(summary, month); renderCategoryBars(summary); renderTemplates(); const list = document.querySelector("#record-list"); list.replaceChildren();
  if (!visible.length) { const p = document.createElement("p"); p.className = "empty"; p.textContent = searchQuery ? "没有匹配的账目。" : "这个月还没有账目。"; list.append(p); return; }
  for (const record of visible) { const row = document.createElement("article"); row.className = "record-item"; const main = document.createElement("div"); main.className = "record-main"; main.innerHTML = "<strong></strong><small></small>"; main.querySelector("strong").textContent = record.category; main.querySelector("small").textContent = `${record.date}${record.note ? ` · ${record.note}` : ""}`; const amount = document.createElement("strong"); amount.className = record.type; amount.textContent = `${record.type === "expense" ? "−" : "+"}${formatMoney(record.amountCents)}`; const menu = document.createElement("button"); menu.className = "record-menu"; menu.type = "button"; menu.ariaLabel = `编辑${record.category}账目`; menu.textContent = "⋯"; menu.addEventListener("click", () => openEditor(record)); row.append(main, amount, menu); list.append(row); }
}

function openEditor(record = null) {
  const form = document.querySelector("#record-form"); form.reset(); const type = record?.type || "expense"; form.elements.type.value = type; document.querySelector("#record-id").value = record?.id || ""; document.querySelector("#amount").value = record?.amountCents ? (record.amountCents / 100).toFixed(2) : ""; document.querySelector("#record-date").value = record?.date || localDate(); document.querySelector("#note").value = record?.note || ""; updateCategories(type, record?.category); document.querySelector("#delete-record").hidden = !record?.id; document.querySelector("#record-dialog").showModal();
}

export async function initLedger() {
  document.querySelector("#month-filter").value = localDate().slice(0, 7);
  [records, customCategories, templates] = await Promise.all([listStore("records"), listStore("categories"), listStore("templates")]); settings = Object.fromEntries((await listStore("settings")).map((item) => [item.id, item.value])); updateCategories("expense"); render();
  document.querySelector("#month-filter").addEventListener("change", render); document.querySelector("#record-search").addEventListener("input", (event) => { searchQuery = event.target.value; render(); }); document.querySelector("#add-record").addEventListener("click", () => openEditor()); document.querySelector("#close-dialog").addEventListener("click", () => document.querySelector("#record-dialog").close()); document.querySelectorAll('input[name="type"]').forEach((radio) => radio.addEventListener("change", () => updateCategories(radio.value)));
  document.querySelector("#set-budget").addEventListener("click", () => { const month = document.querySelector("#month-filter").value; const current = settings[`budget:${month}`] || 0; document.querySelector("#budget-amount").value = current ? String(current / 100) : ""; document.querySelector("#budget-dialog").showModal(); });
  document.querySelector("#budget-form").addEventListener("submit", async (event) => { event.preventDefault(); const month = document.querySelector("#month-filter").value; const cents = Math.round(Number(document.querySelector("#budget-amount").value) * 100); if (!Number.isInteger(cents) || cents < 0) return; settings[`budget:${month}`] = cents; await putStore("settings", { id: `budget:${month}`, value: cents }); document.querySelector("#budget-dialog").close(); render(); toast("预算已保存"); });
  document.querySelector("#manage-categories").addEventListener("click", () => { document.querySelector("#category-form").reset(); document.querySelector("#category-dialog").showModal(); });
  document.querySelector("#category-form").addEventListener("submit", async (event) => { event.preventDefault(); const name = document.querySelector("#category-name").value.trim(); const action = document.querySelector("#category-action").value; if (action === "disable") { const item = customCategories.find((category) => category.name === name && category.type === "expense" && category.active); if (!item) return alert("没有找到这个启用中的自定义分类"); item.active = false; await putStore("categories", item); } else { if (categoriesFor("expense").includes(name)) return alert("这个分类已经存在"); const item = { id: crypto.randomUUID(), name, type: "expense", active: true }; customCategories.push(item); await putStore("categories", item); } document.querySelector("#category-dialog").close(); updateCategories("expense"); render(); toast("分类已更新"); });
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => document.querySelector(`#${button.dataset.closeDialog}`).close()));
  document.querySelector("#delete-record").addEventListener("click", async () => { const id = document.querySelector("#record-id").value; if (!id || !confirm("确定删除这笔账目吗？")) return; await deleteStore("records", id); records = records.filter((item) => item.id !== id); document.querySelector("#record-dialog").close(); render(); toast("账目已删除"); });
  document.querySelector("#record-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const id = document.querySelector("#record-id").value; const old = records.find((item) => item.id === id); const record = validateRecord({ id: id || crypto.randomUUID(), type: form.elements.type.value, amountCents: Math.round(Number(document.querySelector("#amount").value) * 100), category: document.querySelector("#category").value, date: document.querySelector("#record-date").value, note: document.querySelector("#note").value, createdAt: old?.createdAt || new Date().toISOString() }); await putStore("records", record); records = records.filter((item) => item.id !== record.id).concat(record); if (document.querySelector("#save-template").checked) { const template = { id: crypto.randomUUID(), title: record.note || record.category, type: record.type, amountCents: record.amountCents, category: record.category }; templates.push(template); await putStore("templates", template); } document.querySelector("#record-dialog").close(); render(); toast("账目已保存"); });
  document.querySelector("#export-button").addEventListener("click", () => { const blob = new Blob([JSON.stringify(createBackup(records, new Date().toISOString(), { settings, categories: customCategories, templates }), null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `缘的账本备份-${localDate()}.json`; a.click(); URL.revokeObjectURL(a.href); });
  document.querySelector("#import-input").addEventListener("change", async (event) => { try { const backup = parseBackup(await event.target.files[0].text()); if (!confirm(`将用备份中的 ${backup.records.length} 笔账目替换当前数据，是否继续？`)) return; const settingsRows = Object.entries(backup.settings).map(([id, value]) => ({ id, value })); await Promise.all([replaceStore("records", backup.records), replaceStore("settings", settingsRows), replaceStore("categories", backup.categories), replaceStore("templates", backup.templates)]); records = backup.records; settings = backup.settings; customCategories = backup.categories; templates = backup.templates; render(); toast("备份已恢复"); } catch (error) { alert(error.message); } finally { event.target.value = ""; } });
}
