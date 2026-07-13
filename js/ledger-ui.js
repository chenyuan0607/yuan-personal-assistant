import { createBackup, formatMoney, parseBackup, sortRecords, summarizeMonth, validateRecord } from "./ledger.js";

const DB_NAME = "yuan-personal-ledger";
const STORE = "records";
const categories = { expense: ["餐饮", "交通", "购物", "住房", "娱乐", "健康", "其他"], income: ["工资", "奖金", "红包", "退款", "其他"] };
let records = [];

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    const result = action(store);
    transaction.oncomplete = () => { db.close(); resolve(result?.result); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

const storage = {
  async list() { return (await transact("readonly", (store) => store.getAll())) || []; },
  put(record) { return transact("readwrite", (store) => store.put(record)); },
  remove(id) { return transact("readwrite", (store) => store.delete(id)); },
  async replaceAll(next) { await transact("readwrite", (store) => { store.clear(); next.forEach((item) => store.put(item)); }); },
};

function localDate() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()); }
function showToast(message) { const toast = document.querySelector("#toast"); toast.textContent = message; toast.hidden = false; setTimeout(() => { toast.hidden = true; }, 2200); }

function updateCategories(type, selected = "") {
  const select = document.querySelector("#category");
  select.replaceChildren(...categories[type].map((name) => new Option(name, name, false, name === selected)));
}

function render() {
  const month = document.querySelector("#month-filter").value;
  const monthRecords = sortRecords(records).filter((item) => item.date.startsWith(`${month}-`));
  const summary = summarizeMonth(records, month);
  document.querySelector("[data-expense]").textContent = formatMoney(summary.expenseCents);
  document.querySelector("[data-income]").textContent = formatMoney(summary.incomeCents);
  document.querySelector("[data-balance]").textContent = formatMoney(summary.balanceCents);
  document.querySelector("[data-record-count]").textContent = `${monthRecords.length} 笔`;
  const list = document.querySelector("#record-list");
  list.replaceChildren();
  if (!monthRecords.length) { const p = document.createElement("p"); p.className = "empty"; p.textContent = "这个月还没有账目。"; list.append(p); return; }
  for (const record of monthRecords) {
    const row = document.createElement("article"); row.className = "record-item";
    const main = document.createElement("div"); main.className = "record-main";
    const title = document.createElement("strong"); title.textContent = record.category;
    const detail = document.createElement("small"); detail.textContent = `${record.date}${record.note ? ` · ${record.note}` : ""}`;
    main.append(title, detail);
    const amount = document.createElement("strong"); amount.className = record.type; amount.textContent = `${record.type === "expense" ? "−" : "+"}${formatMoney(record.amountCents)}`;
    const menu = document.createElement("button"); menu.className = "record-menu"; menu.type = "button"; menu.ariaLabel = `编辑${record.category}账目`; menu.textContent = "⋯"; menu.addEventListener("click", () => openEditor(record));
    row.append(main, amount, menu); list.append(row);
  }
}

function openEditor(record = null) {
  const form = document.querySelector("#record-form"); form.reset();
  const type = record?.type || "expense";
  form.elements.type.value = type;
  document.querySelector("#record-id").value = record?.id || "";
  document.querySelector("#amount").value = record ? (record.amountCents / 100).toFixed(2) : "";
  document.querySelector("#record-date").value = record?.date || localDate();
  document.querySelector("#note").value = record?.note || "";
  updateCategories(type, record?.category);
  document.querySelector("#delete-record").hidden = !record;
  document.querySelector("#record-dialog").showModal();
}

export async function initLedger() {
  const month = document.querySelector("#month-filter"); month.value = localDate().slice(0, 7);
  records = await storage.list(); render(); updateCategories("expense");
  month.addEventListener("change", render);
  document.querySelector("#add-record").addEventListener("click", () => openEditor());
  document.querySelector("#close-dialog").addEventListener("click", () => document.querySelector("#record-dialog").close());
  document.querySelector("#delete-record").addEventListener("click", async () => {
    const id = document.querySelector("#record-id").value;
    if (!id || !confirm("确定删除这笔账目吗？")) return;
    await storage.remove(id);
    records = records.filter((item) => item.id !== id);
    document.querySelector("#record-dialog").close(); render(); showToast("账目已删除");
  });
  document.querySelectorAll('input[name="type"]').forEach((radio) => radio.addEventListener("change", () => updateCategories(radio.value)));
  document.querySelector("#record-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const id = document.querySelector("#record-id").value;
    const old = records.find((item) => item.id === id);
    const record = validateRecord({ id: id || crypto.randomUUID(), type: form.elements.type.value, amountCents: Math.round(Number(document.querySelector("#amount").value) * 100), category: document.querySelector("#category").value, date: document.querySelector("#record-date").value, note: document.querySelector("#note").value, createdAt: old?.createdAt || new Date().toISOString() });
    await storage.put(record); records = records.filter((item) => item.id !== record.id).concat(record); document.querySelector("#record-dialog").close(); render(); showToast("账目已保存");
  });
  document.querySelector("#export-button").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(createBackup(records), null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `缘的账本备份-${localDate()}.json`; a.click(); URL.revokeObjectURL(a.href);
  });
  document.querySelector("#import-input").addEventListener("change", async (event) => {
    try { const next = parseBackup(await event.target.files[0].text()); if (!confirm(`将用备份中的 ${next.length} 笔账目替换当前数据，是否继续？`)) return; await storage.replaceAll(next); records = next; render(); showToast("备份已恢复"); } catch (error) { alert(error.message); } finally { event.target.value = ""; }
  });
}
