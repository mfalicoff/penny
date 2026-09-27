import { test } from "node:test";
import assert from "node:assert/strict";
import { changeCurrency, deleteEntry, removeSchedule, saveCategory, saveEntry, setScheduleActive } from "../src/domain/commands.ts";
import { emptyLedger, type Recurring, type Transaction } from "../src/domain/ledger.ts";

const entry: Transaction = { id: "lunch", title: "Lunch", kind: "expense", total: 2000, share: 1000, categoryId: "food", date: "2026-01-31", note: "" };
const rule: Recurring = { ...entry, id: "weekly-lunch", frequency: "monthly", anchorDay: 31, active: false, nextDate: "2026-01-31" };

test("entry edits merge with unrelated changes and never mutate the source ledger", () => {
  const ledger = { ...emptyLedger(), transactions: [entry, { ...entry, id: "other" }] };
  const before = structuredClone(ledger);
  const updated = saveEntry({ ...entry, title: "Dinner" }, entry)(ledger);
  assert.deepEqual(ledger, before);
  assert.equal(updated.transactions.length, 2);
  assert.equal(updated.transactions.find((t) => t.id === "other")?.title, "Lunch");
  assert.equal(updated.transactions.find((t) => t.id === entry.id)?.title, "Dinner");
});

test("stale entry edits and deletions fail without replacing newer data", () => {
  const changed = { ...emptyLedger(), transactions: [{ ...entry, share: 1500 }] };
  assert.throws(() => saveEntry(entry, entry)(changed), /changed on another device/);
  assert.throws(() => deleteEntry(entry)(changed), /changed on another device/);
  assert.throws(() => saveEntry(entry, entry)(emptyLedger()), /changed on another device/);
  assert.throws(() => deleteEntry(entry)(emptyLedger()), /changed on another device/);
});

test("saving checks the latest category and creates a schedule atomically with its entry", () => {
  const ledger = emptyLedger();
  assert.throws(() => saveEntry({ ...entry, categoryId: "missing" })(ledger), /Choose another category/);
  assert.throws(() => saveEntry({ ...entry, categoryId: "salary" })(ledger), /Choose another category/);
  const next = saveEntry({ ...entry, recurringId: rule.id }, undefined, rule)(ledger);
  assert.equal(next.transactions[0].recurringId, next.recurring[0].id);
  assert.equal(deleteEntry(next.transactions[0])(next).recurring.length, 1);
});

test("categories reject duplicate names and stale edits including stale deletions", () => {
  const ledger = emptyLedger();
  const original = ledger.categories[0];
  assert.throws(() => saveCategory({ ...original, id: "new", name: "GROCERIES" })(ledger), /already have/);
  const next = saveCategory({ ...original, name: "Fresh food" }, original)(ledger);
  assert.throws(() => saveCategory(original, original)(next), /changed on another device/);
  assert.throws(() => saveCategory(original, original, true)(next), /changed on another device/);
  assert.equal(saveCategory({ ...original, id: "income-groceries", kind: "income" })(ledger).categories.length, ledger.categories.length + 1);
});

test("categories used by either entries or paused schedules cannot be removed", () => {
  const ledger = emptyLedger();
  const food = ledger.categories.find((c) => c.id === "food")!;
  for (const used of [{ ...ledger, transactions: [entry] }, { ...ledger, recurring: [rule] }])
    assert.throws(() => saveCategory(food, food, true)(used), /preserve your history/);
  assert.equal(saveCategory(food, food, true)(ledger).categories.some((c) => c.id === food.id), false);
});

test("resuming skips paused dates, preserves month-end anchors, and is safe to replay", () => {
  const ledger = { ...emptyLedger(), recurring: [rule], transactions: [entry] };
  const resume = setScheduleActive(rule.id, true, "2026-03-01");
  const next = resume(ledger);
  assert.equal(next.recurring[0].nextDate, "2026-03-31");
  assert.equal(next.recurring[0].active, true);
  assert.deepEqual(resume(next), next);
  assert.deepEqual(next.transactions, [entry]);
  assert.equal(ledger.recurring[0].active, false);
  assert.equal(setScheduleActive(rule.id, false)(next).recurring[0].nextDate, "2026-03-31");
  assert.deepEqual(removeSchedule(rule.id)(next).transactions, [entry]);
});

test("currency cannot change once there is transaction or schedule history", () => {
  const ledger = emptyLedger();
  assert.equal(changeCurrency("USD")(ledger).currency, "USD");
  assert.equal(ledger.currency, "CAD");
  assert.throws(() => changeCurrency("USD")({ ...ledger, transactions: [entry] }), /before adding entries/);
  assert.throws(() => changeCurrency("USD")({ ...ledger, recurring: [rule] }), /before adding entries/);
});
