import test from "node:test";
import assert from "node:assert/strict";
import { isPlanStale, taskId, validatePlan } from "../js/tasks.js";

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

test("validates weekly and monthly briefing cards", () => {
  const plan = validatePlan({
    ...validPlan,
    briefings: [
      {
        type: "weekly",
        title: "上一周总结",
        summary: "上周主要在跑通个人助手闭环。",
        period: "2026-07-06 至 2026-07-12",
        details: ["任务反馈链路已开始运转。", "下周继续压低任务颗粒度。"],
      },
      {
        type: "monthly",
        title: "上个月总结",
        summary: "上个月重点是搭建生活记录和成长系统。",
        period: "2026-06",
        details: ["下个月方向：稳定执行、轻量记录。"],
      },
    ],
  });

  assert.equal(plan.briefings.length, 2);
  assert.equal(plan.briefings[0].type, "weekly");
  assert.throws(() => validatePlan({ ...validPlan, briefings: [{ type: "yearly", title: "坏卡片", summary: "x" }] }), /推送类型/);
  assert.throws(() => validatePlan({ ...validPlan, briefings: [{ type: "weekly", title: "", summary: "x" }] }), /推送标题/);
});

test("detects stale plans by Beijing calendar date", () => {
  assert.equal(isPlanStale("2026-07-12", new Date("2026-07-13T01:00:00Z")), true);
  assert.equal(isPlanStale("2026-07-13", new Date("2026-07-13T01:00:00Z")), false);
});

test("task ids remain stable for the same dated task", () => {
  assert.equal(taskId("2026-07-14", "must", 0, "整理资料"), taskId("2026-07-14", "must", 0, "整理资料"));
  assert.notEqual(taskId("2026-07-14", "must", 0, "整理资料"), taskId("2026-07-14", "must", 1, "整理资料"));
});
