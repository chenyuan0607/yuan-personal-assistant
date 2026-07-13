export const formatMessage = (message) => ({
  id: message.id,
  role: message.role,
  content: String(message.content ?? ""),
  createdAt: message.createdAt,
  date: message.date,
  sources: (message.sources ?? []).map(({ title, url, date }) => ({ title, url, date })),
});

export function groupMessagesByDate(messages) {
  return messages.reduce((groups, message) => {
    (groups[message.date] ||= []).push(message);
    return groups;
  }, {});
}
