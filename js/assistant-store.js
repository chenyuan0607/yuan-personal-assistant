export function createMemoryStore(initial = {}) {
  const state = { token: initial.token ?? null, deviceName: initial.deviceName ?? "我的手机", pending: [...(initial.pending ?? [])] };
  return {
    token: () => state.token,
    setToken: (token) => { state.token = token; },
    setSession: ({ token, deviceName }) => { state.token = token; state.deviceName = deviceName; },
    deviceName: () => state.deviceName,
    clearToken: () => { state.token = null; },
    enqueue: (message) => { state.pending.push(message); },
    pending: () => [...state.pending],
    ack: (id) => { state.pending = state.pending.filter((item) => item.id !== id); },
  };
}

export function createBrowserStore(storage = localStorage) {
  const load = () => {
    try { return JSON.parse(storage.getItem("yuan-assistant-session") || "{}"); }
    catch { return {}; }
  };
  const save = (value) => storage.setItem("yuan-assistant-session", JSON.stringify(value));
  return {
    token: () => load().token ?? null,
    setToken(token) { save({ ...load(), token }); },
    setSession({ token, deviceName }) { save({ ...load(), token, deviceName }); },
    deviceName: () => load().deviceName ?? "我的手机",
    clearToken() { save({ ...load(), token: null }); },
    pending: () => load().pending ?? [],
    enqueue(message) { save({ ...load(), pending: [...(load().pending ?? []), message] }); },
    ack(id) { save({ ...load(), pending: (load().pending ?? []).filter((item) => item.id !== id) }); },
  };
}
