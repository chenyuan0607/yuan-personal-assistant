export function createSession({ taskId, title, minutes, now = Date.now() }) {
  if (!taskId || !title || !Number.isInteger(minutes) || minutes <= 0) throw new Error("番茄钟任务无效");
  return { taskId, title, plannedSeconds: minutes * 60, focusedSeconds: 0, runningSince: now, status: "running" };
}

export function elapsedSeconds(session, now = Date.now()) {
  return session.focusedSeconds + (session.status === "running" ? Math.max(0, Math.floor((now - session.runningSince) / 1000)) : 0);
}

export function remainingMs(session, now = Date.now()) {
  return Math.max(0, (session.plannedSeconds - elapsedSeconds(session, now)) * 1000);
}

export function pauseSession(session, now = Date.now()) {
  if (session.status !== "running") return session;
  return { ...session, focusedSeconds: elapsedSeconds(session, now), runningSince: null, status: "paused" };
}

export function resumeSession(session, now = Date.now()) {
  if (session.status !== "paused") return session;
  return { ...session, runningSince: now, status: "running" };
}

export function completeSession(session, { outcome, now = Date.now(), eventId, date, deviceName }) {
  if (!["completed", "unfinished"].includes(outcome)) throw new Error("完成结果无效");
  return {
    id: eventId,
    kind: "task-result",
    taskId: session.taskId,
    title: session.title,
    date,
    deviceName,
    plannedMinutes: session.plannedSeconds / 60,
    focusedSeconds: elapsedSeconds(session, now),
    outcome,
    completedAt: new Date(now).toISOString(),
  };
}

export function progressSummary(results, taskIds) {
  const activeTaskIds = new Set(taskIds);
  const activeResults = results.filter((item) => activeTaskIds.has(item.taskId));
  const latest = new Map();
  for (const result of activeResults) latest.set(result.taskId, result);
  const completed = taskIds.filter((id) => latest.get(id)?.outcome === "completed").length;
  const focusedSeconds = activeResults.reduce((sum, item) => sum + item.focusedSeconds, 0);
  return {
    completed,
    total: taskIds.length,
    percent: taskIds.length ? Math.round(completed / taskIds.length * 100) : 0,
    focusedMinutes: Math.floor(focusedSeconds / 60),
  };
}

export function formatClock(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function taskStatus(results, taskId) {
  const latest = [...results].reverse().find((item) => item.taskId === taskId);
  return latest?.outcome ?? "not-started";
}
