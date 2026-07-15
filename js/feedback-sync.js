export async function flushFeedback(store, api) {
  if (!api.hasToken()) return { sent: 0 };
  let sent = 0;
  for (const record of store.pending()) {
    await api.saveFeedback(record);
    store.ack(record.id);
    sent += 1;
  }
  return { sent };
}

export async function syncTaskProgress(store, api, date) {
  if (!api.hasToken() || !date || typeof store.mergeResults !== "function") return { merged: 0 };
  const body = await api.listFeedback(date);
  const items = (body.items || []).filter((item) => item.kind === "task-plan" || item.kind === "task-result");
  store.mergeResults(items);
  return { merged: items.length };
}
