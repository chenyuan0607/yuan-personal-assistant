import test from "node:test";
import assert from "node:assert/strict";

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
} from "../js/pomodoro.js";
import { createPomodoroStore } from "../js/pomodoro-store.js";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

test("timer uses the task suggested minutes and excludes pauses", () => {
  const started = createSession({ taskId: "t1", title: "整理资料", minutes: 20, now: 1_000 });
  assert.equal(remainingMs(started, 61_000), 1_140_000);
  const paused = pauseSession(started, 61_000);
  const resumed = resumeSession(paused, 181_000);
  assert.equal(remainingMs(resumed, 241_000), 1_080_000);
});

test("completion keeps attempts and progress counts only completed tasks", () => {
  const session = createSession({ taskId: "t1", title: "整理资料", minutes: 20, now: 0 });
  const result = completeSession(session, {
    outcome: "unfinished",
    now: 600_000,
    eventId: "e1",
    date: "2026-07-14",
    deviceName: "手机A",
  });
  assert.equal(result.focusedSeconds, 600);
  assert.deepEqual(progressSummary([result], ["t1", "t2"]), { completed: 0, total: 2, percent: 0, focusedMinutes: 10 });
});

test("daily progress ignores results from other dated task ids", () => {
  assert.deepEqual(progressSummary([
    { taskId: "today", outcome: "completed", focusedSeconds: 300 },
    { taskId: "yesterday", outcome: "completed", focusedSeconds: 3600 },
  ], ["today"]), { completed: 1, total: 1, percent: 100, focusedMinutes: 5 });
});

test("browser store restores the active timer and queued results", () => {
  const storage = memoryStorage();
  const first = createPomodoroStore(storage);
  first.saveSession({ taskId: "t1", status: "paused" });
  first.addResult({ id: "e1", taskId: "t1", focusedSeconds: 120 });
  first.addResult({ id: "e1", taskId: "t1", focusedSeconds: 120 });
  const second = createPomodoroStore(storage);
  assert.equal(second.session().taskId, "t1");
  assert.deepEqual(second.pending().map((item) => item.id), ["e1"]);
  assert.equal(second.results().length, 1);
  second.ack("e1");
  assert.deepEqual(second.pending(), []);
  assert.equal(second.results().length, 1);
});

test("browser store merges synced task progress without marking it pending", () => {
  const storage = memoryStorage();
  const store = createPomodoroStore(storage);
  store.addResult({ id: "local", kind: "task-result", taskId: "t1", outcome: "unfinished", completedAt: "2026-07-15T01:00:00Z", focusedSeconds: 60 });
  store.mergeResults([
    { id: "remote", kind: "task-result", taskId: "t2", outcome: "completed", completedAt: "2026-07-15T02:00:00Z", focusedSeconds: 120 },
    { id: "local", kind: "task-result", taskId: "t1", outcome: "completed", completedAt: "2026-07-15T03:00:00Z", focusedSeconds: 180 },
  ]);
  assert.deepEqual(store.results().map((item) => item.id), ["remote", "local"]);
  assert.deepEqual(store.pending().map((item) => item.id), ["local"]);
  assert.equal(taskStatus(store.results(), "t1"), "completed");
});

test("clock and latest task status are deterministic", () => {
  assert.equal(formatClock(1_500_000), "25:00");
  assert.equal(formatClock(61_001), "01:02");
  assert.equal(taskStatus([
    { taskId: "t1", outcome: "unfinished" },
    { taskId: "t1", outcome: "completed" },
  ], "t1"), "completed");
  assert.equal(taskStatus([], "t1"), "not-started");
});

test("task plan feedback includes unstarted tasks without extra fields", () => {
  const record = buildTaskPlanFeedback({
    date: "2026-07-14",
    tasks: [
      { id: "t1", title: "整理资料", minutes: 15 },
      { id: "t2", title: "学习", minutes: 25 },
    ],
    updatedAt: "2026-07-14T01:00:00Z",
  });
  assert.deepEqual(record.tasks, [
    { taskId: "t1", title: "整理资料", plannedMinutes: 15 },
    { taskId: "t2", title: "学习", plannedMinutes: 25 },
  ]);
  assert.equal(record.id, "plan-2026-07-14");
});
