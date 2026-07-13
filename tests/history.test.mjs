import test from "node:test";
import assert from "node:assert/strict";
import { mergePlanHistory, prunePlanHistory } from "../js/history.js";

const plan = (date, focus) => ({ date, updatedAt: `${date}T09:10:00+08:00`, focus, adjustment: "", groups: { must: [], should: [], optional: [] } });

test("replaces the same date and sorts newest first", () => {
  const result = mergePlanHistory([plan("2026-07-12", "旧")], plan("2026-07-12", "新"), "2026-07-13");
  assert.equal(result.length, 1);
  assert.equal(result[0].focus, "新");
});

test("keeps only the latest seven Beijing calendar days", () => {
  const history = ["05", "06", "07", "08", "09", "10", "11", "12", "13"].map((day) => plan(`2026-07-${day}`, day));
  assert.deepEqual(prunePlanHistory(history, "2026-07-13").map((item) => item.date), ["2026-07-13", "2026-07-12", "2026-07-11", "2026-07-10", "2026-07-09", "2026-07-08", "2026-07-07"]);
});
