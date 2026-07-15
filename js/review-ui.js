import { beijingDate } from "./tasks.js";
import { mergePlanHistory } from "./history.js";
import { validateWeeklySummary } from "./weekly.js";

const DB = "yuan-task-history";
function openDb() { return new Promise((resolve, reject) => { const request = indexedDB.open(DB, 1); request.onupgradeneeded = () => request.result.createObjectStore("plans", { keyPath: "date" }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function allPlans() { const db = await openDb(); return new Promise((resolve, reject) => { const tx = db.transaction("plans", "readonly"); const request = tx.objectStore("plans").getAll(); tx.oncomplete = () => { db.close(); resolve(request.result || []); }; tx.onerror = () => reject(tx.error); }); }
async function replacePlans(plans) { const db = await openDb(); return new Promise((resolve, reject) => { const tx = db.transaction("plans", "readwrite"); const store = tx.objectStore("plans"); store.clear(); plans.forEach((plan) => store.put(plan)); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); }); }

function renderHistory(history) {
  const root = document.querySelector("#history-list"); root.replaceChildren();
  if (!history.length) { const p = document.createElement("p"); p.className = "empty"; p.textContent = "打开每日任务后，这里会自动留下最近记录。"; root.append(p); return; }
  for (const plan of history) { const item = document.createElement("article"); item.className = "history-item"; const count = Object.values(plan.groups).flat().length; const small = document.createElement("small"); small.textContent = `${plan.date} · ${count} 项任务`; const focus = document.createElement("strong"); focus.textContent = plan.focus; item.append(small, focus); root.append(item); }
}

function renderWeekly(summary) {
  document.querySelector("[data-weekly-direction]").textContent = summary.direction; document.querySelector("[data-weekly-summary]").textContent = summary.summary; document.querySelector("[data-weekly-evidence]").textContent = summary.evidence; document.querySelector("[data-weekly-updated]").textContent = `更新于 ${new Date(summary.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}`;
  const list = document.querySelector("[data-weekly-adjustments]"); list.replaceChildren(...summary.adjustments.map((text) => { const li = document.createElement("li"); li.textContent = text; return li; }));
}

export async function initReview(plan) {
  let history = await allPlans(); if (plan) { history = mergePlanHistory(history, plan, beijingDate()); await replacePlans(history); } renderHistory(history);
  try { const response = await fetch(`./data/weekly.json?t=${Date.now()}`, { cache: "no-cache" }); if (!response.ok) throw new Error("周总结加载失败"); const weekly = validateWeeklySummary(await response.json()); localStorage.setItem("yuan-weekly-cache", JSON.stringify(weekly)); renderWeekly(weekly); }
  catch { const cached = localStorage.getItem("yuan-weekly-cache"); if (cached) renderWeekly(validateWeeklySummary(JSON.parse(cached))); else { document.querySelector("[data-weekly-direction]").textContent = "本周总结暂时不可用"; document.querySelector("[data-weekly-summary]").textContent = "今日任务和账本仍可正常使用。"; } }
}
