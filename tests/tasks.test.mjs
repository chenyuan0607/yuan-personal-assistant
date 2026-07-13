import test from "node:test";
import assert from "node:assert/strict";
import { isPlanStale, validatePlan } from "../js/tasks.js";

const validPlan = {
  date: "2026-07-13",
  updatedAt: "2026-07-13T09:10:00+08:00",
  focus: "完成最重要的一件事",
  adjustment: "任务保持精简。",
  groups: {
    must: [{ title: "推进核心工作", minutes: 60 }],
    should: [{ title: "整理笔记", minutes: 20 }],
    optional: [],
  },
};

test("validates a daily plan", () => {
  assert.equal(validatePlan(validPlan).focus, validPlan.focus);
  assert.throws(() => validatePlan({ ...validPlan, focus: "" }), /焦点/);
  assert.throws(() => validatePlan({ ...validPlan, groups: { must: [{}], should: [], optional: [] } }), /任务标题/);
});

test("detects stale plans by Beijing calendar date", () => {
  assert.equal(isPlanStale("2026-07-12", new Date("2026-07-13T01:00:00Z")), true);
  assert.equal(isPlanStale("2026-07-13", new Date("2026-07-13T01:00:00Z")), false);
});
