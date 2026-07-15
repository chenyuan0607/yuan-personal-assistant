export const formatMessage = (message) => ({
  id: message.id,
  role: message.role,
  content: String(message.content ?? ""),
  createdAt: message.createdAt,
  date: message.date,
  sources: (message.sources ?? []).map(({ title, url, date }) => ({ title, url, date })),
});

function beijingParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function dayNumber(day) {
  return Math.floor(Date.parse(`${day}T00:00:00+08:00`) / 86400000);
}

export function formatChatTimeLabel(value, now = new Date()) {
  const target = beijingParts(value);
  const today = beijingParts(now).day;
  const diff = dayNumber(today) - dayNumber(target.day);
  if (diff === 0) return target.time;
  if (diff === 1) return `昨天 ${target.time}`;
  return `${target.day.replaceAll("-", "/")} ${target.time}`;
}

export function shouldShowTimeDivider(previous, current, gapMinutes = 10) {
  if (!current?.createdAt) return false;
  if (!previous?.createdAt) return true;
  return new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime() >= gapMinutes * 60000;
}

export function groupMessagesByDate(messages) {
  return messages.reduce((groups, message) => {
    (groups[message.date] ||= []).push(message);
    return groups;
  }, {});
}
