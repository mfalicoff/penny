import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyLedger, type Transaction } from "../src/domain/ledger.ts";
import { calendarMonth, selectOverview, shiftMonthKey } from "../src/features/overview/selectors.ts";

const expense: Transaction = { id: "meal", title: "Lunch", kind: "expense", total: 4000, share: 1000, categoryId: "food", date: "2026-09-20", note: "With Alex" };
const ledger = { ...emptyLedger(), transactions: [expense, { ...expense, id: "salary", title: "Payday", note: "", kind: "income" as const, categoryId: "salary", share: 50000, date: "2026-09-21" }, { ...expense, id: "last-month", date: "2026-08-31" }] };
const filters = { month: "2026-09", day: null, filter: "all" as const, search: "" };

test("overview totals use monthly personal shares independently of list filters", () => {
  const before = structuredClone(ledger);
  const result = selectOverview(ledger, { ...filters, search: "missing" });
  assert.deepEqual(result.summary, { expense: 1000, income: 50000, investment: 0 });
  assert.equal(result.visibleEntries.length, 0);
  assert.equal(result.monthEntries.length, 2);
  assert.equal(result.spending[0].amount, 1000);
  assert.deepEqual(ledger, before);
});

test("search matches title, category and note without case sensitivity", () => {
  for (const search of ["LUNCH", "Food & drinks", "alex"])
    assert.deepEqual(selectOverview(ledger, { ...filters, search }).visibleEntries.map((t) => t.id), ["meal"]);
});

test("day and kind filters combine and groups remain in descending date order", () => {
  assert.equal(selectOverview(ledger, { ...filters, day: "2026-09-20", filter: "income" }).visibleEntries.length, 0);
  assert.deepEqual(selectOverview(ledger, { ...filters, filter: "expense" }).visibleEntries.map((t) => t.id), ["meal"]);
  assert.deepEqual([...selectOverview(ledger, filters).grouped.keys()], ["2026-09-21", "2026-09-20"]);
  const sameDay = { ...ledger, transactions: [...ledger.transactions, { ...expense, id: "dinner" }] };
  assert.deepEqual(selectOverview(sameDay, filters).grouped.get(expense.date)?.map((t) => t.id), ["meal", "dinner"]);
});

test("empty months have no spending and zero totals", () => {
  const result = selectOverview(ledger, { ...filters, month: "2027-01" });
  assert.deepEqual(result.summary, { expense: 0, income: 0, investment: 0 });
  assert.deepEqual(result.spending, []);
  assert.equal(result.grouped.size, 0);
});

test("calendar handles leap years, Monday starts, six-week months and year boundaries", () => {
  assert.deepEqual(calendarMonth("2021-02"), { daysInMonth: 28, offset: 0, calendarCells: 28 });
  assert.equal(calendarMonth("2024-02").daysInMonth, 29);
  assert.deepEqual(calendarMonth("2026-03"), { daysInMonth: 31, offset: 6, calendarCells: 42 });
  assert.equal(shiftMonthKey("2026-12", 1), "2027-01");
  assert.equal(shiftMonthKey("2026-01", -1), "2025-12");
});

test("future schedules appear in calendar and filtered lists without changing recorded totals or the ledger", () => {
  const rule = { ...expense, id: "rent", frequency: "monthly" as const, active: true, anchorDay: 31, nextDate: "2026-09-30" };
  const data = { ...ledger, recurring: [rule] };
  const before = structuredClone(data);
  const result = selectOverview(data, { ...filters, month: "2026-10", day: "2026-10-31", search: "alex" });
  assert.equal(result.calendarEntries.length, 1);
  assert.equal(result.visibleEntries[0].scheduled, true);
  assert.equal(result.visibleEntries[0].recurringId, rule.id);
  assert.equal(result.visibleEntries[0].date, "2026-10-31");
  assert.deepEqual(result.summary, { expense: 0, income: 0, investment: 0 });
  assert.equal(result.monthEntries.length, 0);
  assert.deepEqual(data, before);
});

test("previews respect paused schedules, weekly repeats, leap years, and recorded occurrences", () => {
  const monthly = { ...expense, id: "rent", frequency: "monthly" as const, active: true, anchorDay: 31, nextDate: "2024-01-31" };
  const weekly = { ...monthly, id: "weekly", frequency: "weekly" as const, nextDate: "2024-02-02" };
  const yearly = { ...monthly, id: "yearly", frequency: "yearly" as const, anchorDay: 29, nextDate: "2023-02-28" };
  const data = { ...emptyLedger(), recurring: [monthly, weekly, yearly, { ...monthly, id: "paused", active: false }],
    transactions: [{ ...expense, id: "weekly:2024-02-09", date: "2024-02-09", recurringId: weekly.id }] };
  const result = selectOverview(data, { ...filters, month: "2024-02" });
  assert.equal(result.calendarEntries.length, 6);
  assert.equal(result.calendarEntries.filter((t) => t.date === "2024-02-29").length, 2);
  assert.equal(result.calendarEntries.filter((t) => t.date === "2024-02-09").length, 1);
  assert.equal(result.calendarEntries.some((t) => t.recurringId === "paused"), false);
});
