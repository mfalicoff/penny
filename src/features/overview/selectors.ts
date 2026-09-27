import { dateKey, parseDate, totals, type Ledger, type Transaction } from "../../domain/ledger.ts";

export type EntryFilter = "all" | "expense" | "income";
export type OverviewFilters = { month: string; day: string | null; filter: EntryFilter; search: string; };

export function selectOverview(ledger: Ledger, { month, day, filter, search }: OverviewFilters) {
  const categories = new Map(ledger.categories.map((c) => [c.id, c]));
  const monthEntries = ledger.transactions.filter((t) => t.date.startsWith(month));
  const summary = totals(monthEntries);
  const query = search.toLowerCase();
  const visibleEntries = monthEntries.filter((t) =>
    (!day || t.date === day) && (filter === "all" || t.kind === filter) &&
    `${t.title} ${t.note} ${categories.get(t.categoryId)?.name ?? ""}`.toLowerCase().includes(query),
  ).sort((a, b) => b.date.localeCompare(a.date));
  const grouped = new Map<string, Transaction[]>();
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
  return { monthEntries, summary, visibleEntries, grouped, spending };
}

export function calendarMonth(month: string) {
  const date = parseDate(`${month}-01`);
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const offset = (date.getDay() + 6) % 7;
  return { daysInMonth, offset, calendarCells: Math.ceil((daysInMonth + offset) / 7) * 7 };
}

export function shiftMonthKey(month: string, delta: number) {
  const date = parseDate(`${month}-01`);
  return dateKey(new Date(date.getFullYear(), date.getMonth() + delta, 1)).slice(0, 7);
}
