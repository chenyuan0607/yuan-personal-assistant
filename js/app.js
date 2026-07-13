import { initLedger } from "./ledger-ui.js";
import { loadPlan } from "./tasks.js";
import { initReview } from "./review-ui.js";
import { initAssistant } from "./assistant-ui.js";

document.querySelectorAll(".bottom-nav button").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".view").forEach((view) => { view.hidden = view.id !== button.dataset.view; });
  document.querySelectorAll(".bottom-nav button").forEach((item) => item.classList.toggle("active", item === button));
  if (button.dataset.view === "assistant-view") assistantRefresh();
}));

const assistantBaseUrl = document.documentElement.dataset.assistantApi || location.origin;
const assistantRefresh = initAssistant({ baseUrl: assistantBaseUrl });
const planResult = await Promise.allSettled([loadPlan(document.querySelector("#today-view")), initLedger()]);
await initReview(planResult[0].status === "fulfilled" ? planResult[0].value : null);

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("./service-worker.js");
}
