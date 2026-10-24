import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyLedger, type Transaction } from "../../src/domain/ledger.ts";
import { PAGE_SIZE, selectTransactions, shiftTransactionPeriod, type TransactionFilters } from "../../src/features/transactions/selectors.ts";

const expense: Transaction = { id: "meal", title: "Lunch", kind: "expense", total: 4000, share: 1000, categoryId: "food", accountId: "visa", date: "2024-02-29", note: "With Alex" };
const ledger = { ...emptyLedger(), accounts: [{ id: "visa", name: "Everyday Visa", type: "credit" as const }], transactions: [
  expense,
  { ...expense, id: "salary", kind: "income" as const, share: 50000, date: "2024-01-01" },
  { ...expense, id: "invest", kind: "investment" as const, share: 5000, date: "2024-12-31" },
  { ...expense, id: "outside-before", date: "2023-12-31" },
  { ...expense, id: "outside-after", date: "2025-01-01" },
], recurring: [{ ...expense, id: "future", active: true, frequency: "monthly" as const, anchorDay: 29, nextDate: "2024-03-29" }] };
const filters: TransactionFilters = { month: "2024-02", period: "month", filter: "all", search: "", page: 0 };

test("month and year include exact boundaries, personal shares and recorded entries only", () => {
  const before = structuredClone(ledger);
  assert.deepEqual(selectTransactions(ledger, filters).summary, { expense: 1000, income: 0, investment: 0 });
  const year = selectTransactions(ledger, { ...filters, period: "year" });
  assert.deepEqual(year.summary, { expense: 1000, income: 50000, investment: 5000 });
  assert.deepEqual([...year.grouped.keys()], ["2024-12-31", "2024-02-29", "2024-01-01"]);
  assert.equal(year.totalCount, 3);
  assert.deepEqual(ledger, before);
});

test("search and kind combine while totals continue to describe the whole period", () => {
  for (const search of [" LUNCH ", "alex", "Food & drinks", "VISA"]) {
    const result = selectTransactions(ledger, { ...filters, period: "year", filter: "expense", search });
    assert.deepEqual(result.visibleEntries.map((entry) => entry.id), ["meal"]);
    assert.equal(result.summary.income, 50000);
  }
  const empty = selectTransactions(ledger, { ...filters, search: "missing" });
  assert.equal(empty.totalCount, 0);
  assert.equal(empty.summary.expense, 1000);
  assert.deepEqual(selectTransactions(ledger, { ...filters, month: "2026-02" }).summary, { expense: 0, income: 0, investment: 0 });
});

test("pagination reaches every matching entry and clamps after data changes", () => {
  const data = { ...ledger, transactions: Array.from({ length: PAGE_SIZE + 1 }, (_, index) => ({ ...expense, id: String(index).padStart(3, "0") })) };
  const first = selectTransactions(data, filters);
  const last = selectTransactions(data, { ...filters, page: 1 });
  assert.equal(first.visibleEntries.length, PAGE_SIZE);
  assert.equal(last.visibleEntries.length, 1);
  assert.equal(new Set([...first.visibleEntries, ...last.visibleEntries].map((entry) => entry.id)).size, PAGE_SIZE + 1);
  assert.equal(last.summary.expense, (PAGE_SIZE + 1) * expense.share);
  assert.equal(selectTransactions(ledger, { ...filters, page: 1 }).page, 0);
});

test("period navigation crosses years and respects supported date bounds", () => {
  assert.equal(shiftTransactionPeriod("2024-12", "month", 1), "2025-01");
  assert.equal(shiftTransactionPeriod("2024-01", "month", -1), "2023-12");
  assert.equal(shiftTransactionPeriod("2024-02", "year", -1), "2023-02");
  assert.equal(shiftTransactionPeriod("2000-01", "month", -1), "2000-01");
  assert.equal(shiftTransactionPeriod("2100-12", "year", 1), "2100-12");
});
