const formatTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};

function renderList(list, summary, notifications) {
  list.innerHTML = "";
  if (!notifications.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "还没有工作通知。以后 Codex 完成项目、发布网页、整理失败等提醒都会放在这里。";
    list.append(empty);
    if (summary) summary.textContent = "暂无新的工作提醒";
    return;
  }
  if (summary) summary.textContent = `最近 ${notifications.length} 条提醒`;
  for (const item of notifications) {
    const card = document.createElement("article");
    card.className = `work-notification-item ${item.level || "info"}`;
    const meta = document.createElement("small");
    meta.textContent = `${item.source || "codex"} · ${formatTime(item.createdAt)}`;
    const title = document.createElement("strong");
    title.textContent = item.title || "工作通知";
    const body = document.createElement("p");
    body.textContent = item.body || "没有补充内容。";
    card.append(meta, title, body);
    list.append(card);
  }
}

export function initWorkNotifications({ api, root = document } = {}) {
  const list = root.querySelector("#work-notifications-list");
  const summary = root.querySelector("#work-notifications-summary");
  if (!list || !api?.listWorkNotifications) return async () => {};

  const refresh = async () => {
    try {
      const data = await api.listWorkNotifications();
      renderList(list, summary, data.notifications || []);
    } catch (error) {
      list.innerHTML = "";
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = api.hasToken?.() ? "工作通知暂时读取失败，稍后再试。" : "登录后显示工作通知。";
      list.append(empty);
      if (summary) summary.textContent = "点击查看系统提醒";
    }
  };

  refresh();
  return refresh;
}
