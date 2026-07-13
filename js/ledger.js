const RECORD_TYPES = new Set(["income", "expense"]);

export function validateRecord(record) {
  if (!record || typeof record !== "object") throw new Error("账目格式无效");
  if (!record.id || typeof record.id !== "string") throw new Error("账目编号无效");
  if (!RECORD_TYPES.has(record.type)) throw new Error("账目类型无效");
  if (!Number.isInteger(record.amountCents) || record.amountCents <= 0) throw new Error("金额必须大于零");
  if (!record.category || typeof record.category !== "string") throw new Error("请选择分类");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date)) throw new Error("账目日期无效");
  return {
    id: record.id,
    type: record.type,
    amountCents: record.amountCents,
    category: record.category.trim(),
    date: record.date,
    note: typeof record.note === "string" ? record.note.trim().slice(0, 80) : "",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
  };
}

export function summarizeMonth(records, yearMonth) {
  const summary = { incomeCents: 0, expenseCents: 0, balanceCents: 0, categories: {} };
  for (const raw of records) {
    const record = validateRecord(raw);
    if (!record.date.startsWith(`${yearMonth}-`)) continue;
    if (record.type === "income") summary.incomeCents += record.amountCents;
    else {
      summary.expenseCents += record.amountCents;
      summary.categories[record.category] = (summary.categories[record.category] || 0) + record.amountCents;
    }
  }
  summary.balanceCents = summary.incomeCents - summary.expenseCents;
  return summary;
}

export function sortRecords(records) {
  return [...records].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export function budgetStatus(spentCents, budgetCents) {
  const ratio = budgetCents > 0 ? spentCents / budgetCents : 0;
  return { state: budgetCents <= 0 || ratio < 0.8 ? "normal" : ratio <= 1 ? "warning" : "over", ratio, remainingCents: budgetCents - spentCents };
}

export function rankCategories(categories) {
  return Object.entries(categories).map(([category, amountCents]) => ({ category, amountCents })).sort((a, b) => b.amountCents - a.amountCents || a.category.localeCompare(b.category));
}

export function filterRecords(records, query) {
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  if (!normalized) return records;
  return records.filter((record) => `${record.category} ${record.note || ""}`.toLocaleLowerCase("zh-CN").includes(normalized));
}

export function createBackup(records, exportedAt = new Date().toISOString(), extras = {}) {
  return { version: 2, exportedAt, records: records.map(validateRecord), settings: extras.settings || {}, categories: extras.categories || [], templates: extras.templates || [] };
}

export function parseBackup(text) {
  let backup;
  try { backup = JSON.parse(text); } catch { throw new Error("无法读取备份文件"); }
  if (![1, 2].includes(backup?.version) || !Array.isArray(backup.records)) throw new Error("备份版本不受支持");
  const records = backup.records.map(validateRecord);
  if (backup.version === 1) return { version: 1, records, settings: {}, categories: [], templates: [] };
  if (!backup.settings || typeof backup.settings !== "object" || !Array.isArray(backup.categories) || !Array.isArray(backup.templates)) throw new Error("备份设置格式无效");
  if (Object.entries(backup.settings).some(([key, value]) => !key.startsWith("budget:") || !Number.isInteger(value) || value < 0)) throw new Error("预算设置格式无效");
  if (backup.categories.some((item) => !item?.id || !item.name?.trim() || !["income", "expense"].includes(item.type) || typeof item.active !== "boolean")) throw new Error("自定义分类格式无效");
  if (backup.templates.some((item) => !item?.id || !item.title?.trim() || !["income", "expense"].includes(item.type) || !Number.isInteger(item.amountCents) || item.amountCents <= 0 || !item.category?.trim())) throw new Error("常用账目格式无效");
  return { version: 2, records, settings: backup.settings, categories: backup.categories, templates: backup.templates };
}

export function formatMoney(cents) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(cents / 100);
}
