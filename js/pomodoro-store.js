const STORAGE_KEY = "yuan-pomodoro-v1";

export function createPomodoroStore(storage = localStorage) {
  const load = () => {
    try {
      const value = JSON.parse(storage.getItem(STORAGE_KEY) || "{}");
      return {
        session: value.session ?? null,
        results: Array.isArray(value.results) ? value.results : [],
        pending: Array.isArray(value.pending) ? value.pending : [],
      };
    } catch {
      return { session: null, results: [], pending: [] };
    }
  };
  const save = (value) => storage.setItem(STORAGE_KEY, JSON.stringify(value));
  return {
    session: () => load().session,
    saveSession(session) { save({ ...load(), session }); },
    clearSession() { save({ ...load(), session: null }); },
    results: () => [...load().results],
    addResult(result) {
      const state = load();
      const results = state.results.filter((item) => item.id !== result.id).concat(result);
      const pending = state.pending.filter((item) => item.id !== result.id).concat(result);
      save({ ...state, results, pending });
    },
    pending: () => [...load().pending],
    ack(id) {
      const state = load();
      save({ ...state, pending: state.pending.filter((item) => item.id !== id) });
    },
  };
}
