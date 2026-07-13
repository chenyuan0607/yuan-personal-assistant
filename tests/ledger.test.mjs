import test from "node:test";
import assert from "node:assert/strict";
import {
  createBackup,
  parseBackup,
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
  assert.equal(parseBackup(JSON.stringify(backup)).length, 3);
  assert.throws(() => parseBackup('{"version":2,"records":[]}'), /备份版本/);
  assert.throws(() => parseBackup("not json"), /无法读取/);
});
