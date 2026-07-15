import test from "node:test";
import assert from "node:assert/strict";
import {
  budgetStatus,
  buildDailyLedgerSummary,
  createBackup,
  filterRecords,
  parseBackup,
  rankCategories,
  sortRecords,
  summarizeMonth,
  validateRecord,
} from "../js/ledger.js";

const records = [
  { id: "1", type: "expense", amountCents: 3580, category: "餐饮", date: "2026-07-13", note: "午餐", createdAt: "2026-07-13T04:00:00Z" },
  { id: "2", type: "income", amountCents: 100000, category: "工资", date: "2026-07-01", note: "", createdAt: "2026-07-01T04:00:00Z" },
  { id: "3", type: "expense", amountCents: 2000, category: "餐饮", date: "2026-06-30", note: "", createdAt: "2026-06-30T04:00:00Z" },
];

test("validates ledger records", () => {
  assert.equal(validateRecord(records[0]).amountCents, 3580);
  assert.throws(() => validateRecord({ ...records[0], amountCents: 0 }), /金额/);
  assert.throws(() => validateRecord({ ...records[0], type: "transfer" }), /类型/);
});

test("summarizes one month without floating point currency", () => {
  assert.deepEqual(summarizeMonth(records, "2026-07"), {
    incomeCents: 100000,
    expenseCents: 3580,
    balanceCents: 96420,
    categories: { "餐饮": 3580 },
  });
});

test("sorts newest records first", () => {
  assert.deepEqual(sortRecords(records).map((item) => item.id), ["1", "2", "3"]);
});

test("round-trips a versioned backup and rejects malformed input", () => {
  const backup = createBackup(records, "2026-07-13T05:00:00.000Z");
  assert.equal(parseBackup(JSON.stringify(backup)).records.length, 3);
  assert.throws(() => parseBackup('{"version":3,"records":[]}'), /备份版本/);
  assert.throws(() => parseBackup("not json"), /无法读取/);
});

test("classifies monthly budget thresholds", () => {
  assert.equal(budgetStatus(7900, 10000).state, "normal");
  assert.equal(budgetStatus(8000, 10000).state, "warning");
  assert.equal(budgetStatus(10000, 10000).state, "warning");
  assert.deepEqual(budgetStatus(12000, 10000), { state: "over", ratio: 1.2, remainingCents: -2000 });
});

test("ranks categories and searches category or note", () => {
  assert.deepEqual(rankCategories({ 交通: 2400, 餐饮: 6800 }).map((item) => item.category), ["餐饮", "交通"]);
  assert.deepEqual(filterRecords(records, "午餐").map((item) => item.id), ["1"]);
  assert.deepEqual(filterRecords(records, "工资").map((item) => item.id), ["2"]);
});

test("imports legacy backups and round-trips version 2 settings", () => {
  const legacy = parseBackup(JSON.stringify({ version: 1, exportedAt: "2026-07-13T00:00:00Z", records }));
  assert.equal(legacy.version, 1);
  assert.deepEqual(legacy.settings, {});
  const v2 = createBackup(records, "2026-07-13T00:00:00Z", { settings: { "budget:2026-07": 300000 }, categories: [{ id: "c1", name: "学习", type: "expense", active: true }], templates: [{ id: "t1", title: "早餐", amountCents: 1200, category: "餐饮", type: "expense" }] });
  const restored = parseBackup(JSON.stringify(v2));
  assert.equal(restored.version, 2);
  assert.equal(restored.settings["budget:2026-07"], 300000);
  assert.equal(restored.categories[0].name, "学习");
});

test("rejects malformed version 2 extras before replacing data", () => {
  const base = { version: 2, records, settings: {}, categories: [], templates: [] };
  assert.throws(() => parseBackup(JSON.stringify({ ...base, settings: { "budget:2026-07": -1 } })), /预算设置/);
  assert.throws(() => parseBackup(JSON.stringify({ ...base, categories: [{ name: "" }] })), /自定义分类/);
  assert.throws(() => parseBackup(JSON.stringify({ ...base, templates: [{ title: "早餐", amountCents: 0 } ] })), /常用账目/);
});

test("daily ledger summary exposes aggregates but no record details", () => {
  const result = buildDailyLedgerSummary(records, { "budget:2026-07": 300000 }, "2026-07-13", "手机A", "2026-07-13T23:59:00Z");
  assert.deepEqual(result.categories, { 餐饮: 3580 });
  assert.equal(result.expenseCents, 3580);
  assert.equal(result.incomeCents, 0);
  assert.equal(result.monthBudgetCents, 300000);
  assert.equal(result.monthExpenseCents, 3580);
  assert.equal(result.monthRemainingCents, 296420);
  assert.equal(JSON.stringify(result).includes("午餐"), false);
  assert.equal(JSON.stringify(result).includes('"records"'), false);
  assert.match(result.id, /^ledger-2026-07-13-[a-z0-9]+$/);
  assert.equal(result.id, buildDailyLedgerSummary(records, { "budget:2026-07": 300000 }, "2026-07-13", "手机A", "2026-07-13T23:59:00Z").id);
});
