export function validateWeeklySummary(summary) {
  if (!summary || typeof summary !== "object") throw new Error("周总结格式无效");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(summary.weekStart || "")) throw new Error("周开始日期无效");
  for (const field of ["summary", "direction", "evidence"]) if (!summary[field] || typeof summary[field] !== "string") throw new Error("周总结内容不完整");
  if (!Array.isArray(summary.adjustments) || summary.adjustments.length < 1 || summary.adjustments.length > 3 || summary.adjustments.some((item) => !item || typeof item !== "string")) throw new Error("调整建议必须为 1–3 条");
  return summary;
}
