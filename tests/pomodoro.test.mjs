import test from "node:test";
import assert from "node:assert/strict";

import {
  completeSession,
  createSession,
  pauseSession,
  progressSummary,
  remainingMs,
  resumeSession,
} from "../js/pomodoro.js";

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
