import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyLedger } from "../../src/domain/ledger.ts";
import { buildEntry, buildSchedule, type EntryDraft } from "../../src/features/entries/entryDraft.ts";

const draft: EntryDraft = { kind: "expense", title: " Dinner ", amount: "10.01", date: "2026-01-31", categoryId: "food", note: " shared ", split: "equal", shareInput: "3", frequency: "monthly", receipt: { id: "receipt", name: "Bill", mime: "image/png", uri: "receipt" } };
const categories = emptyLedger().categories;

test("entry drafts trim text, calculate personal shares, and build linked schedules without receipts", () => {
  const { transaction, recurring } = buildEntry(draft, categories);
  assert.equal(transaction.title, "Dinner");
  assert.equal(transaction.note, "shared");
  assert.equal(transaction.total, 1001);
  assert.equal(transaction.share, 334);
  assert.equal(transaction.receipt, draft.receipt);
  assert.equal(transaction.recurringId, recurring?.id);
  assert.equal(recurring?.nextDate, "2026-02-28");
  assert.equal(recurring?.anchorDay, 31);
  assert.equal("receipt" in recurring!, false);
});

test("editing an occurrence preserves its identity and never creates a second schedule", () => {
  const { transaction } = buildEntry(draft, categories);
  const edited = buildEntry({ ...draft, title: "Updated" }, categories, transaction);
  assert.equal(edited.transaction.id, transaction.id);
  assert.equal(edited.transaction.recurringId, transaction.recurringId);
  assert.equal(edited.recurring, undefined);
});

test("income always records the full amount and omits expense receipts", () => {
  const { transaction } = buildEntry({ ...draft, kind: "income", categoryId: "salary" }, categories);
  assert.equal(transaction.share, transaction.total);
  assert.equal(transaction.receipt, undefined);
});

test("invalid dates, empty titles, zero amounts and category-kind mismatches are rejected", () => {
  for (const changes of [{ date: "2026-02-30" }, { title: " " }, { amount: "0" }, { categoryId: "salary" }])
    assert.throws(() => buildEntry({ ...draft, ...changes }, categories));
});


test("schedule drafts preserve month-end anchors unless the next date changes", () => {
  const original = { ...buildEntry(draft, categories).recurring!, active: false };
  const edited = buildSchedule({ ...draft, date: original.nextDate, amount: "30.00", title: "Updated" }, categories, original);
  assert.equal(edited.anchorDay, 31);
  assert.equal(edited.nextDate, "2026-02-28");
  assert.equal(edited.date, "2026-01-31");
  assert.equal(edited.total, 3000);
  assert.equal(edited.share, 1000);
  assert.equal(edited.active, false);
  assert.equal(edited.id, original.id);
  assert.equal("receipt" in edited, false);
  const moved = buildSchedule({ ...draft, date: "2026-03-15", frequency: "weekly" }, categories, original);
  assert.equal(moved.anchorDay, 15);
  assert.equal(moved.frequency, "weekly");
  assert.throws(() => buildSchedule({ ...draft, frequency: "none" }, categories, original), /Choose a repeat/);
  assert.throws(() => buildSchedule({ ...draft, date: "2026-02-30" }, categories, original), /valid date/);
});
