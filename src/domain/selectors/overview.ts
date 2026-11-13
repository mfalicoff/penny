import { shiftMonthKey, calendarMonth } from "../calendar.ts";
import type { Ledger } from "../ledger.ts";
import { byDateDescThenId, searchLookups, searchMatcher, type EntryFilter } from "../search.ts";
import { monthBreakdown, scheduledEntries, type OverviewEntry } from "../summary.ts";

// Re-exported so screens keep one import site.
export { calendarMonth, shiftMonthKey, scheduledEntries };
export type { EntryFilter, OverviewEntry };
/** `today` (the local date) makes income dated after it expected (MAZ-136, see `MonthOptions`). */
export type OverviewFilters = { month: string; day: string | null; filter: EntryFilter; categoryId: string | null; search: string; today: string };

export function selectOverview(ledger: Ledger, { month, day, filter, categoryId, search, today }: OverviewFilters) {
  const { recordedEntries: monthEntries, expected, scheduled, calendarEntries, summaryEntries, expectedIncome, recorded, summary } =
    monthBreakdown(ledger, month, { today });
  const matches = searchMatcher(search, searchLookups(ledger));
  const visibleEntries = calendarEntries.filter((t) =>
    (!day || t.date === day) && (filter === "all" || t.kind === filter) &&
    (categoryId === null || t.categoryId === categoryId) && matches(t),
  ).sort(byDateDescThenId);
  const grouped = new Map<string, OverviewEntry[]>();
  for (const entry of visibleEntries) {
    const group = grouped.get(entry.date);
    if (group) group.push(entry);
    else grouped.set(entry.date, [entry]);
  }
  const amounts = new Map<string, number>();
  for (const entry of monthEntries) {
    if (entry.kind === "expense") amounts.set(entry.categoryId, (amounts.get(entry.categoryId) ?? 0) + entry.share);
  }
  const spending = ledger.categories.filter((c) => c.kind === "expense")
    .map((c) => ({ ...c, amount: amounts.get(c.id) ?? 0 }))
    .filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);
  return { monthEntries, expected, scheduled, calendarEntries, summaryEntries, expectedIncome, recorded, summary, visibleEntries, grouped, spending };
}
