import { byDateDescThenId, matchesSearch, searchLookups } from "../search.ts";
import { totals, type Ledger, type Transaction } from "../ledger.ts";
import { shiftMonthKey, type EntryFilter } from "./overview.ts";

export type TransactionFilters = {
  month: string;
  period: "month" | "year";
  filter: EntryFilter;
  search: string;
  page: number;
};

export const PAGE_SIZE = 50;

export function shiftTransactionPeriod(month: string, period: TransactionFilters["period"], delta: number) {
  const next = shiftMonthKey(month, delta * (period === "year" ? 12 : 1));
  return next < "2000-01" || next > "2100-12" ? month : next;
}

export function selectTransactions(ledger: Ledger, filters: TransactionFilters) {
  const prefix = filters.period === "year" ? filters.month.slice(0, 4) : filters.month;
  // Only recorded transactions contribute to history and totals, including recorded recurring entries.
  const periodEntries = ledger.transactions.filter((entry) => entry.date.startsWith(`${prefix}-`));
  const summary = totals(periodEntries);
  const lookups = searchLookups(ledger);
  const query = filters.search.trim();
  const matches = periodEntries.filter((entry) =>
    (filters.filter === "all" || entry.kind === filters.filter) && matchesSearch(entry, query, lookups),
  ).sort(byDateDescThenId);
  const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const page = Math.max(0, Math.min(filters.page, pageCount - 1));
  const visibleEntries = matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const grouped = new Map<string, Transaction[]>();
  for (const entry of visibleEntries) {
    const group = grouped.get(entry.date);
    if (group) group.push(entry);
    else grouped.set(entry.date, [entry]);
  }
  return { summary, visibleEntries, grouped, totalCount: matches.length, page, pageCount };
}
