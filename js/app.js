import { initLedger } from "./ledger-ui.js";
import { loadPlan } from "./tasks.js";

document.querySelectorAll(".bottom-nav button").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".view").forEach((view) => { view.hidden = view.id !== button.dataset.view; });
  document.querySelectorAll(".bottom-nav button").forEach((item) => item.classList.toggle("active", item === button));
}));

await Promise.allSettled([loadPlan(document.querySelector("#today-view")), initLedger()]);

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("./service-worker.js");
}
