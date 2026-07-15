import {
  buildTaskPlanFeedback,
  completeSession,
  createSession,
  formatClock,
  pauseSession,
  progressSummary,
  remainingMs,
  resumeSession,
  taskStatus,
} from "./pomodoro.js";
import { taskId } from "./tasks.js";

const GROUPS = ["must", "should", "optional"];

function planTasks(plan) {
  return GROUPS.flatMap((group) => plan.groups[group].map((item, index) => ({
    id: taskId(plan.date, group, index, item.title),
    title: item.title,
    minutes: item.minutes,
  })));
}

function notifyFinished() {
  try { navigator.vibrate?.([250, 120, 250]); } catch { /* device does not support vibration */ }
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.value = 0.12;
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + 0.35);
  } catch { /* audio notification is best effort */ }
}

export function initPomodoro({ root = document, store, getDeviceName = () => "我的手机", onPending = async () => {} }) {
  const todayView = root.querySelector("#today-view");
  const timerView = root.querySelector("#pomodoro-view");
  const navigation = root.querySelector(".bottom-nav");
  const resultDialog = root.querySelector("#pomodoro-result-dialog");
  resultDialog.addEventListener("cancel", (event) => event.preventDefault());
  let currentPlan = null;
  let tasks = [];
  let ticker = null;
  let awaitingResult = false;

  const showToday = () => {
    timerView.hidden = true;
    todayView.hidden = false;
    navigation.hidden = false;
  };

  const showTimer = () => {
    todayView.hidden = true;
    timerView.hidden = false;
    navigation.hidden = true;
  };

  const renderProgress = () => {
    const results = store.results();
    const summary = progressSummary(results, tasks.map((item) => item.id));
    root.querySelector("[data-task-percent]").textContent = `${summary.percent}%`;
    root.querySelector("[data-task-count]").textContent = `已完成 ${summary.completed} / ${summary.total} 项`;
    root.querySelector("[data-focus-minutes]").textContent = `今日专注 ${summary.focusedMinutes} 分钟`;
    const track = root.querySelector(".task-progress-track");
    track.setAttribute("aria-valuenow", String(summary.percent));
    root.querySelector("[data-task-progress]").style.width = `${summary.percent}%`;
    for (const item of tasks) {
      const row = todayView.querySelector(`[data-task-id="${item.id}"]`);
      if (!row) continue;
      const status = store.session()?.taskId === item.id ? "running" : taskStatus(results, item.id);
      row.dataset.taskStatus = status;
      row.classList.toggle("task-completed", status === "completed");
      row.classList.toggle("task-unfinished", status === "unfinished");
      row.classList.toggle("task-running", status === "running");
    }
  };

  const openResult = (session) => {
    if (awaitingResult || resultDialog.open) return;
    awaitingResult = true;
    clearInterval(ticker); ticker = null;
    root.querySelector("[data-pomodoro-result-task]").textContent = session.title;
    const focusedMinutes = Math.max(1, Math.ceil((session.focusedSeconds + (session.status === "running" ? Math.max(0, Math.floor((Date.now() - session.runningSince) / 1000)) : 0)) / 60));
    root.querySelector("[data-pomodoro-result-time]").textContent = `本次专注约 ${focusedMinutes} 分钟，请确认任务结果。`;
    notifyFinished();
    resultDialog.showModal();
  };

  const renderTimer = () => {
    const session = store.session();
    if (!session) { showToday(); return; }
    showTimer();
    root.querySelector("[data-pomodoro-title]").textContent = session.title;
    root.querySelector("[data-pomodoro-planned]").textContent = `建议用时 ${session.plannedSeconds / 60} 分钟`;
    const left = remainingMs(session);
    root.querySelector("[data-pomodoro-clock]").textContent = formatClock(left);
    root.querySelector("[data-pomodoro-state]").textContent = session.status === "paused" ? "已暂停，暂停时间不会计入专注" : "正在专注";
    root.querySelector("#pomodoro-toggle").textContent = session.status === "paused" ? "继续" : "暂停";
    if (left === 0) openResult(session);
  };

  const startTicker = () => {
    clearInterval(ticker);
    renderTimer();
    if (store.session()?.status === "running" && !awaitingResult) ticker = setInterval(renderTimer, 1000);
  };

  todayView.addEventListener("click", (event) => {
    const button = event.target.closest(".pomodoro-launch");
    if (!button) return;
    const existing = store.session();
    if (!existing) {
      store.saveSession(createSession({
        taskId: button.dataset.taskId,
        title: button.dataset.taskTitle,
        minutes: Number(button.dataset.taskMinutes),
      }));
    }
    renderProgress();
    startTicker();
  });

  root.querySelector("#pomodoro-toggle").addEventListener("click", () => {
    const session = store.session();
    if (!session) return;
    store.saveSession(session.status === "paused" ? resumeSession(session) : pauseSession(session));
    renderProgress();
    startTicker();
  });

  root.querySelector("#pomodoro-stop").addEventListener("click", () => {
    const session = store.session();
    if (session) openResult(session);
  });

  root.querySelector("#pomodoro-back").addEventListener("click", () => {
    clearInterval(ticker); ticker = null;
    showToday();
    renderProgress();
  });

  resultDialog.querySelectorAll("[data-pomodoro-outcome]").forEach((button) => button.addEventListener("click", async () => {
    const session = store.session();
    if (!session || !currentPlan) return;
    const result = completeSession(session, {
      outcome: button.dataset.pomodoroOutcome,
      eventId: crypto.randomUUID(),
      date: currentPlan.date,
      deviceName: getDeviceName(),
    });
    store.addResult(result);
    store.clearSession();
    awaitingResult = false;
    renderProgress();
    showToday();
    await onPending();
  }));

  return {
    bindPlan(plan) {
      currentPlan = plan;
      tasks = planTasks(plan);
      const planFeedback = buildTaskPlanFeedback({ date: plan.date, tasks, updatedAt: plan.updatedAt });
      const previous = store.results().find((item) => item.id === planFeedback.id);
      if (JSON.stringify(previous) !== JSON.stringify(planFeedback)) {
        store.addResult(planFeedback);
        void onPending();
      }
      renderProgress();
      if (store.session()) startTicker();
    },
    refresh: renderProgress,
  };
}
