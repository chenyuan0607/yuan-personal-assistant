import test from "node:test";
import assert from "node:assert/strict";
import { validateWeeklySummary } from "../js/weekly.js";

test("validates a weekly summary with one to three adjustments", () => {
  const valid = { weekStart: "2026-07-13", updatedAt: "2026-07-13T09:10:00+08:00", summary: "系统已经开始运转。", direction: "稳定执行。", evidence: "依据近期任务与完成记录。", adjustments: ["每天只推进一件重点。"] };
  assert.equal(validateWeeklySummary(valid).direction, "稳定执行。");
  assert.throws(() => validateWeeklySummary({ ...valid, adjustments: [] }), /调整建议/);
  assert.throws(() => validateWeeklySummary({ ...valid, adjustments: ["1", "2", "3", "4"] }), /调整建议/);
});
