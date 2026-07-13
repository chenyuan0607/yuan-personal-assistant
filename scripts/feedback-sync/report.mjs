const money = (cents) => `¥${(Number(cents || 0) / 100).toFixed(2)}`;

export function buildFeedbackReport({ date, items, syncedAt }) {
  const plan = [...items].filter((item) => item.kind === "task-plan").sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt))).at(-1);
  const results = items.filter((item) => item.kind === "task-result").sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)));
  const tasks = plan?.tasks ?? [...new Map(results.map((item) => [item.taskId, { taskId: item.taskId, title: item.title, plannedMinutes: item.plannedMinutes }])).values()];
  const resultGroups = new Map(tasks.map((task) => [task.taskId, []]));
  for (const result of results) {
    if (!resultGroups.has(result.taskId)) resultGroups.set(result.taskId, []);
    resultGroups.get(result.taskId).push(result);
  }
  const completed = tasks.filter((task) => resultGroups.get(task.taskId)?.at(-1)?.outcome === "completed").length;
  const focusedMinutes = Math.floor(results.reduce((sum, item) => sum + item.focusedSeconds, 0) / 60);
  const percent = tasks.length ? Math.round(completed / tasks.length * 100) : 0;
  const taskLines = tasks.length ? tasks.map((task, index) => {
    const attempts = resultGroups.get(task.taskId) ?? [];
    const focused = Math.floor(attempts.reduce((sum, item) => sum + item.focusedSeconds, 0) / 60);
    const outcome = attempts.at(-1)?.outcome === "completed" ? "已完成" : attempts.length ? "未完成" : "未开始";
    return `${index + 1}. ${task.title}\n   - 建议 ${task.plannedMinutes} 分钟｜专注 ${focused} 分钟｜启动 ${attempts.length} 次｜${outcome}`;
  }).join("\n") : "- 当日没有任务清单";
  const ledgers = items.filter((item) => item.kind === "ledger-summary").sort((a, b) => a.deviceName.localeCompare(b.deviceName, "zh-CN"));
  const ledgerBlocks = ledgers.length ? ledgers.map((item) => {
    const categories = Object.entries(item.categories ?? {}).sort((a, b) => b[1] - a[1]).map(([name, cents]) => `${name}：${money(cents)}`).join("、") || "无支出";
    const budget = item.monthBudgetCents > 0 ? `${money(item.monthBudgetCents)}，已用 ${money(item.monthExpenseCents)}，剩余 ${money(item.monthRemainingCents)}` : "未设置月预算";
    return `### ${item.deviceName}\n\n- 当日收入：${money(item.incomeCents)}（${item.incomeCount} 笔）\n- 当日支出：${money(item.expenseCents)}（${item.expenseCount} 笔）\n- 当日收支差额：${money(item.balanceCents)}\n- 分类支出：${categories}\n- 月预算：${budget}｜状态 ${item.budgetState}`;
  }).join("\n\n") : "- 尚未收到设备账本摘要";
  return `# ${date} 任务与账本反馈\n\n> 最后同步：${syncedAt}\n\n## 今日任务概况\n\n- 已完成 ${completed} / ${tasks.length} 项（${percent}%）\n- 总专注 ${focusedMinutes} 分钟\n\n## 任务明细\n\n${taskLines}\n\n## 隐私化账本摘要\n\n${ledgerBlocks}\n`;
}
