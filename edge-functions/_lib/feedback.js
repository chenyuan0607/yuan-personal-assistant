const safePart = (value) => String(value).replace(/[^A-Za-z0-9]/g, "_");
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (value, label) => {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(`${label}无效`);
  return value;
};
const text = (value, label, max) => {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${label}无效`);
  return normalized;
};
const integer = (value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label}无效`);
  return value;
};

export const feedbackPrefix = (ownerId) => `feedback_${safePart(ownerId)}_`;
export const feedbackKey = (ownerId, kind, date, id) => `${feedbackPrefix(ownerId)}${safePart(kind)}_${safePart(date)}_${safePart(id)}`;

function rejectUnexpected(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("反馈格式无效");
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new Error(`反馈包含不允许的字段：${unexpected.join(",")}`);
}

function validateCategories(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("分类摘要无效");
  const entries = Object.entries(value);
  if (entries.length > 30) throw new Error("分类摘要过多");
  return Object.fromEntries(entries.map(([name, amount]) => [text(name, "分类名称", 24), integer(amount, "分类金额")]));
}

export function validateFeedback(value) {
  const kind = value?.kind;
  if (kind === "task-result") {
    rejectUnexpected(value, new Set(["id", "kind", "taskId", "title", "date", "deviceName", "plannedMinutes", "focusedSeconds", "outcome", "completedAt"]));
    if (!datePattern.test(value.date || "")) throw new Error("反馈日期无效");
    if (!["completed", "unfinished"].includes(value.outcome)) throw new Error("任务结果无效");
    return {
      id: text(value.id, "反馈编号", 80),
      kind,
      taskId: text(value.taskId, "任务编号", 160),
      title: text(value.title, "任务标题", 300),
      date: value.date,
      deviceName: text(value.deviceName, "设备名称", 30),
      plannedMinutes: integer(value.plannedMinutes, "建议分钟数", { minimum: 1, maximum: 1440 }),
      focusedSeconds: integer(value.focusedSeconds, "专注秒数", { maximum: 172800 }),
      outcome: value.outcome,
      completedAt: isoDate(value.completedAt, "完成时间"),
    };
  }
  if (kind === "ledger-summary") {
    rejectUnexpected(value, new Set(["id", "kind", "date", "deviceName", "incomeCents", "expenseCents", "balanceCents", "incomeCount", "expenseCount", "categories", "monthBudgetCents", "monthExpenseCents", "monthRemainingCents", "budgetState", "updatedAt"]));
    if (!datePattern.test(value.date || "")) throw new Error("摘要日期无效");
    if (!["normal", "warning", "over"].includes(value.budgetState)) throw new Error("预算状态无效");
    return {
      id: text(value.id, "摘要编号", 100),
      kind,
      date: value.date,
      deviceName: text(value.deviceName, "设备名称", 30),
      incomeCents: integer(value.incomeCents, "收入合计"),
      expenseCents: integer(value.expenseCents, "支出合计"),
      balanceCents: integer(value.balanceCents, "收支差额", { minimum: -Number.MAX_SAFE_INTEGER }),
      incomeCount: integer(value.incomeCount, "收入笔数", { maximum: 100000 }),
      expenseCount: integer(value.expenseCount, "支出笔数", { maximum: 100000 }),
      categories: validateCategories(value.categories),
      monthBudgetCents: integer(value.monthBudgetCents, "月预算"),
      monthExpenseCents: integer(value.monthExpenseCents, "月支出"),
      monthRemainingCents: integer(value.monthRemainingCents, "预算余额", { minimum: -Number.MAX_SAFE_INTEGER }),
      budgetState: value.budgetState,
      updatedAt: isoDate(value.updatedAt, "摘要时间"),
    };
  }
  throw new Error("反馈类型无效");
}
