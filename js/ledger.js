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

export function createBackup(records, exportedAt = new Date().toISOString()) {
  return { version: 1, exportedAt, records: records.map(validateRecord) };
}

export function parseBackup(text) {
  let backup;
  try { backup = JSON.parse(text); } catch { throw new Error("无法读取备份文件"); }
  if (backup?.version !== 1 || !Array.isArray(backup.records)) throw new Error("备份版本不受支持");
  return backup.records.map(validateRecord);
}

export function formatMoney(cents) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(cents / 100);
}
