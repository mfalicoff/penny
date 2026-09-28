import type { Ledger, Trip, Transaction } from "../../domain/ledger.ts";

export function tripOverview(ledger: Ledger, trip: Trip) {
  const expenses = ledger.transactions
    .filter((entry) => entry.kind === "expense" && entry.tripId === trip.id)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const byCategory = new Map<string, number>();
  for (const entry of expenses)
    byCategory.set(entry.categoryId, (byCategory.get(entry.categoryId) ?? 0) + entry.share);
  const categories = ledger.categories
    .filter((category) => category.kind === "expense")
    .map((category) => ({ ...category, amount: byCategory.get(category.id) ?? 0 }))
    .filter((category) => category.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  return {
    expenses,
    categories,
    total: expenses.reduce((sum, entry) => sum + entry.share, 0),
    receiptTotal: expenses.reduce((sum, entry) => sum + entry.total, 0),
  };
}

export function tripSummaries(transactions: Transaction[]) {
  const summaries = new Map<string, { total: number; count: number }>();
  for (const entry of transactions) {
    if (entry.kind !== "expense" || !entry.tripId) continue;
    const current = summaries.get(entry.tripId) ?? { total: 0, count: 0 };
    current.total += entry.share;
    current.count++;
    summaries.set(entry.tripId, current);
  }
  return summaries;
}
