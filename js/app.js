import { initLedger } from "./ledger-ui.js";
import { loadPlan } from "./tasks.js";
import { initReview } from "./review-ui.js";
import { initAssistant } from "./assistant-ui.js";
import { createBrowserStore } from "./assistant-store.js";
import { createAssistantApi } from "./assistant-api.js";
import { flushFeedback, syncTaskProgress } from "./feedback-sync.js";
import { createPomodoroStore } from "./pomodoro-store.js";
import { initPomodoro } from "./pomodoro-ui.js";
import { initWeather } from "./weather.js";

const showView = (viewId) => {
  document.querySelectorAll(".view").forEach((view) => { view.hidden = view.id !== viewId; });
};

document.querySelectorAll(".bottom-nav button").forEach((button) => button.addEventListener("click", () => {
  showView(button.dataset.view);
  document.querySelectorAll(".bottom-nav button").forEach((item) => item.classList.toggle("active", item === button));
  if (button.dataset.view === "assistant-view") assistantRefresh();
}));

document.querySelectorAll("[data-tool-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.toolView)));
document.querySelector("#assistant-menu-back").addEventListener("click", () => { showView("assistant-view"); assistantRefresh(); });
document.querySelector("#assistant-backstage-back").addEventListener("click", () => showView("assistant-menu-view"));
document.querySelector("#growth-review-back").addEventListener("click", () => showView("other-view"));

const assistantBaseUrl = document.documentElement.dataset.assistantApi || location.origin;
const assistantStore = createBrowserStore();
const pomodoroStore = createPomodoroStore();
const feedbackApi = createAssistantApi({ baseUrl: assistantBaseUrl, getToken: assistantStore.token });
let currentTaskDate = null;
let pomodoro = null;
const syncCloudTaskProgress = async () => {
  if (!currentTaskDate) return { merged: 0 };
  const result = await syncTaskProgress(pomodoroStore, feedbackApi, currentTaskDate).catch(() => ({ merged: 0 }));
  pomodoro?.refresh();
  return result;
};
const flushPendingFeedback = async () => {
  const result = await flushFeedback(pomodoroStore, feedbackApi).catch(() => ({ sent: 0 }));
  await syncCloudTaskProgress();
  return result;
};
const queueFeedback = async (record) => { pomodoroStore.addResult(record); await flushPendingFeedback(); };
const assistantRefresh = initAssistant({ baseUrl: assistantBaseUrl, store: assistantStore, onSession: flushPendingFeedback, onMenu: (viewId = "assistant-menu-view") => showView(viewId) });
pomodoro = initPomodoro({
  store: pomodoroStore,
  getDeviceName: assistantStore.deviceName,
  onPending: flushPendingFeedback,
});
const planResult = await Promise.allSettled([loadPlan(document.querySelector("#today-view")), initLedger({ onSummary: queueFeedback, getDeviceName: assistantStore.deviceName })]);
if (planResult[0].status === "fulfilled") {
  currentTaskDate = planResult[0].value.date;
  pomodoro.bindPlan(planResult[0].value);
  await syncCloudTaskProgress();
}
await initReview(planResult[0].status === "fulfilled" ? planResult[0].value : null);
initWeather();
await flushPendingFeedback();

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("./service-worker.js");
}
