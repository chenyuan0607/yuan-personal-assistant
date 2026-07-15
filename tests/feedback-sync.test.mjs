import test from "node:test";
import assert from "node:assert/strict";

import { buildFeedbackReport } from "../scripts/feedback-sync/report.mjs";
import { syncFeedback } from "../scripts/feedback-sync/run.mjs";

const items = [
  {
    id: "plan-2026-07-14", kind: "task-plan", date: "2026-07-14", updatedAt: "2026-07-14T01:00:00Z",
    tasks: [
      { taskId: "t1", title: "整理资料", plannedMinutes: 10 },
      { taskId: "t2", title: "学习", plannedMinutes: 20 },
    ],
  },
  { id: "e1", kind: "task-result", date: "2026-07-14", taskId: "t1", title: "整理资料", plannedMinutes: 10, focusedSeconds: 600, outcome: "completed", completedAt: "2026-07-14T02:00:00Z", deviceName: "手机A" },
  { id: "e2", kind: "task-result", date: "2026-07-14", taskId: "t2", title: "学习", plannedMinutes: 20, focusedSeconds: 300, outcome: "unfinished", completedAt: "2026-07-14T03:00:00Z", deviceName: "手机A" },
  { id: "ledger-1", kind: "ledger-summary", date: "2026-07-14", deviceName: "手机A", incomeCents: 0, expenseCents: 3580, balanceCents: -3580, incomeCount: 0, expenseCount: 1, categories: { 餐饮: 3580 }, monthBudgetCents: 300000, monthExpenseCents: 3580, monthRemainingCents: 296420, budgetState: "normal", updatedAt: "2026-07-14T23:00:00Z" },
];

test("report groups tasks and ledger summaries by device without details", () => {
  const markdown = buildFeedbackReport({ date: "2026-07-14", items, syncedAt: "2026-07-15T00:10:00+08:00" });
  assert.match(markdown, /已完成 1 \/ 2 项/);
  assert.match(markdown, /总专注 15 分钟/);
  assert.match(markdown, /手机A/);
  assert.match(markdown, /餐饮：¥35\.80/);
  assert.doesNotMatch(markdown, /备注|records|午餐/);
});

test("sync acknowledges only after the report is atomically written", async () => {
  const calls = [];
  const edgeFactory = () => ({
    pullFeedback: async (date) => { calls.push(`pull:${date ?? "all"}`); return { items }; },
    ackFeedback: async (ids, localPath) => { calls.push(`ack:${ids.length}:${localPath.endsWith("2026-07-14-任务与账本反馈.md")}`); },
  });
  const result = await syncFeedback({ EDGEONE_API_URL: "https://edge.example", EDGEONE_CODEX_TOKEN: "token", YUAN_KB_ROOT: "D:\\知识库" }, {
    edgeFactory,
    now: new Date("2026-07-15T00:10:00+08:00"),
    mkdirImpl: async () => calls.push("mkdir"),
    writeFileImpl: async () => calls.push("write"),
    renameImpl: async () => calls.push("rename"),
  });
  assert.deepEqual(calls.slice(0, 4), ["pull:all", "mkdir", "write", "rename"]);
  assert.match(calls[4], /^ack:4:true$/);
  assert.equal(result.items, 4);
});

test("sync writes late feedback back to its original date report", async () => {
  const paths = [];
  const late = [{ id: "late-plan", kind: "task-plan", date: "2026-07-12", updatedAt: "2026-07-12T01:00:00Z", tasks: [] }];
  const edgeFactory = () => ({ pullFeedback: async () => ({ items: [...items, ...late] }), ackFeedback: async () => {} });
  await syncFeedback({ EDGEONE_API_URL: "https://edge.example", EDGEONE_CODEX_TOKEN: "token", YUAN_KB_ROOT: "D:\\知识库" }, {
    edgeFactory,
    now: new Date("2026-07-15T00:10:00+08:00"),
    mkdirImpl: async () => {},
    writeFileImpl: async (path) => paths.push(path),
    renameImpl: async () => {},
  });
  assert.equal(paths.some((path) => path.endsWith("2026-07-12-任务与账本反馈.md.tmp")), true);
  assert.equal(paths.some((path) => path.endsWith("2026-07-14-任务与账本反馈.md.tmp")), true);
});

test("sync never acknowledges when writing fails", async () => {
  const calls = [];
  const edgeFactory = () => ({ pullFeedback: async () => ({ items }), ackFeedback: async () => calls.push("ack") });
  await assert.rejects(() => syncFeedback({ EDGEONE_API_URL: "https://edge.example", EDGEONE_CODEX_TOKEN: "token", YUAN_KB_ROOT: "D:\\知识库" }, {
    edgeFactory,
    now: new Date("2026-07-15T00:10:00+08:00"),
    mkdirImpl: async () => {},
    writeFileImpl: async () => { throw new Error("disk full"); },
    renameImpl: async () => {},
  }), /disk full/);
  assert.deepEqual(calls, []);
});
