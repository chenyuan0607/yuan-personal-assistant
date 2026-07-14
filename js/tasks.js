const GROUPS = ["must", "should", "optional"];
const BRIEFING_TYPES = ["weekly", "monthly"];

export function taskId(date, group, index, title) {
  const source = `${date}|${group}|${index}|${title}`;
  let hash = 2166136261;
  for (const char of source) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `task-${date}-${group}-${index}-${(hash >>> 0).toString(36)}`;
}

export function validatePlan(plan) {
  if (!plan || typeof plan !== "object") throw new Error("计划格式无效");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.date || "")) throw new Error("计划日期无效");
  if (!plan.focus || typeof plan.focus !== "string") throw new Error("今日焦点不能为空");
  if (!plan.groups || typeof plan.groups !== "object") throw new Error("任务分组无效");
  for (const name of GROUPS) {
    if (!Array.isArray(plan.groups[name])) throw new Error("任务分组无效");
    for (const item of plan.groups[name]) {
      if (!item?.title || typeof item.title !== "string") throw new Error("任务标题不能为空");
      if (item.minutes != null && (!Number.isInteger(item.minutes) || item.minutes <= 0)) throw new Error("预计用时无效");
    }
  }
  if (plan.briefings == null) plan.briefings = [];
  if (!Array.isArray(plan.briefings)) throw new Error("推送列表无效");
  for (const item of plan.briefings) {
    if (!BRIEFING_TYPES.includes(item?.type)) throw new Error("推送类型无效");
    if (!item.title || typeof item.title !== "string") throw new Error("推送标题不能为空");
    if (!item.summary || typeof item.summary !== "string") throw new Error("推送摘要不能为空");
    if (item.period != null && typeof item.period !== "string") throw new Error("推送周期无效");
    if (item.details != null && (!Array.isArray(item.details) || item.details.some((line) => typeof line !== "string" || !line.trim()))) throw new Error("推送详情无效");
  }
  return plan;
}

export function beijingDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isPlanStale(date, now = new Date()) {
  return date < beijingDate(now);
}

export function renderPlan(plan, root) {
  const safe = validatePlan(plan);
  root.querySelector("[data-plan-date]").textContent = safe.date;
  root.querySelector("[data-plan-updated]").textContent = new Date(safe.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  root.querySelector("[data-plan-focus]").textContent = safe.focus;
  root.querySelector("[data-plan-adjustment]").textContent = safe.adjustment || "按自己的节奏完成。";
  const briefings = root.querySelector("[data-briefings]");
  const briefingList = root.querySelector("[data-briefing-list]");
  if (briefings && briefingList) {
    briefingList.replaceChildren();
    briefings.hidden = !safe.briefings.length;
    const names = { weekly: "周报", monthly: "月报" };
    for (const item of safe.briefings) {
      const card = document.createElement("details");
      card.className = `briefing-card ${item.type}`;
      const summary = document.createElement("summary");
      const label = document.createElement("span");
      label.className = "briefing-label";
      label.textContent = names[item.type];
      const title = document.createElement("strong");
      title.textContent = item.title;
      const hint = document.createElement("small");
      hint.textContent = item.period ? `${item.period} · 点击查看` : "点击查看";
      summary.append(label, title, hint);
      const body = document.createElement("div");
      body.className = "briefing-body";
      const intro = document.createElement("p");
      intro.textContent = item.summary;
      body.append(intro);
      if (item.details?.length) {
        const list = document.createElement("ul");
        for (const line of item.details) {
          const li = document.createElement("li");
          li.textContent = line;
          list.append(li);
        }
        body.append(list);
      }
      card.append(summary, body);
      briefingList.append(card);
    }
  }
  const labels = { must: "必须完成", should: "尽量完成", optional: "有余力再做" };
  for (const name of GROUPS) {
    const section = root.querySelector(`[data-task-group="${name}"]`);
    const list = section.querySelector("ul");
    list.replaceChildren();
    section.querySelector("h3").textContent = labels[name];
    if (!safe.groups[name].length) section.hidden = true;
    else {
      section.hidden = false;
      for (const [index, item] of safe.groups[name].entries()) {
        const li = document.createElement("li");
        const id = taskId(safe.date, name, index, item.title);
        li.dataset.taskId = id;
        const title = document.createElement("span");
        title.className = "task-title";
        title.textContent = item.title;
        li.append(title);
        if (item.minutes) {
          const actions = document.createElement("div");
          actions.className = "task-actions";
          const time = document.createElement("small");
          time.textContent = `${item.minutes} 分钟`;
          const timer = document.createElement("button");
          timer.type = "button";
          timer.className = "pomodoro-launch";
          timer.dataset.taskId = id;
          timer.dataset.taskTitle = item.title;
          timer.dataset.taskMinutes = String(item.minutes);
          timer.setAttribute("aria-label", `为${item.title}启动${item.minutes}分钟番茄钟`);
          timer.textContent = "◷";
          actions.append(time, timer);
          li.append(actions);
        }
        list.append(li);
      }
    }
  }
  const warning = root.querySelector("[data-plan-warning]");
  warning.hidden = !isPlanStale(safe.date);
}

export async function loadPlan(root) {
  try {
    const response = await fetch(`./data/today.json?t=${Date.now()}`, { cache: "no-cache" });
    if (!response.ok) throw new Error("计划加载失败");
    const plan = validatePlan(await response.json());
    renderPlan(plan, root);
    return plan;
  } catch (error) {
    const warning = root.querySelector("[data-plan-warning]");
    warning.hidden = false;
    warning.textContent = "今日计划暂时无法更新，请稍后再试。账本仍可正常使用。";
    throw error;
  }
}
