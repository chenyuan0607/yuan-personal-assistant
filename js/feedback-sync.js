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
