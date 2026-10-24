import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cents,
  personalShare,
  nextOccurrence,
  materialize,
  emptyLedger,
  totals,
  validDate,
} from "../../src/domain/ledger.ts";

test("money uses integer cents and rejects ambiguous or invalid input", () => {
  assert.equal(cents("10.29"), 1029);
  assert.equal(cents("0.10"), 10);
  for (const [value, expected] of [
    ["10,29", 1029], ["0,10", 10], ["12,3", 1230], ["12,", 1200],
    [" 12,34 ", 1234], ["999999999,99", 99999999999],
  ] as const) assert.equal(cents(value), expected);
  for (const value of ["-1", "1.234", "1,234", "1e2", "NaN", "", "1,000", "1,2.3", "1.2,3", "1,,2", "1..2", "1000000000,00"])
    assert.throws(() => cents(value));
});
test("splits count only your share, with deterministic cent rounding", () => {
  assert.equal(personalShare(1000, "equal", "3"), 333);
  assert.equal(personalShare(1001, "percent", "50"), 501);
  assert.equal(personalShare(12000, "amount", "42.50"), 4250);
  assert.equal(personalShare(12000, "amount", "42,50"), 4250);
  assert.equal(personalShare(10000, "percent", "12,34"), 1234);
  assert.equal(personalShare(100, "amount", "0"), 0);
  assert.throws(() => personalShare(1000, "amount", "11"));
  assert.throws(() => personalShare(1000, "equal", "0"));
  assert.throws(() => personalShare(1000, "percent", "101"));
});
test("monthly dates recover their original anchor after short months", () => {
  assert.equal(nextOccurrence("2026-01-31", "monthly", 31), "2026-02-28");
  assert.equal(nextOccurrence("2026-02-28", "monthly", 31), "2026-03-31");
  assert.equal(nextOccurrence("2024-02-29", "yearly", 29), "2025-02-28");
  assert.equal(nextOccurrence("2026-12-28", "weekly", 28), "2027-01-04");
});
test("missed recurring entries catch up once and paused schedules stay paused", () => {
  const data = emptyLedger();
  data.recurring.push({
    id: "rent",
    title: "Rent",
    kind: "expense",
    total: 200000,
    share: 100000,
    categoryId: "home",
    date: "2026-01-31",
    nextDate: "2026-01-31",
    anchorDay: 31,
    frequency: "monthly",
    active: true,
    note: "",
  });
  const updated = materialize(data, "2026-04-01");
  assert.deepEqual(
    updated.transactions.map((t) => t.date),
    ["2026-01-31", "2026-02-28", "2026-03-31"],
  );
  assert.equal(updated.recurring[0].nextDate, "2026-04-30");
  assert.equal(totals(updated.transactions).expense, 300000);
  assert.deepEqual(materialize(updated, "2026-04-01"), updated);
  updated.transactions.pop();
  assert.equal(
    materialize(updated, "2026-04-01").transactions.length,
    2,
    "deleted occurrences do not regenerate",
  );
  data.recurring[0].active = false;
  assert.equal(materialize(data, "2026-04-01").transactions.length, 0);
});
test("dates reject nonexistent calendar days", () => {
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(validDate("not-a-date"), false);
});
