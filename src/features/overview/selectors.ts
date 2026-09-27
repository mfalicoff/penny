import { dateKey, nextOccurrence, parseDate, totals, type Kind, type Ledger, type Transaction } from "../../domain/ledger.ts";

export type OverviewEntry = Transaction & { scheduled?: boolean };

export type EntryFilter = "all" | Kind;
export type OverviewFilters = { month: string; day: string | null; filter: EntryFilter; search: string; };

export function selectOverview(ledger: Ledger, { month, day, filter, search }: OverviewFilters) {
  const categories = new Map(ledger.categories.map((c) => [c.id, c]));
  const accounts = new Map(ledger.accounts.map((a) => [a.id, a]));
  const monthEntries = ledger.transactions.filter((t) => t.date.startsWith(month));
  const scheduled = scheduledEntries(ledger, month);
  const calendarEntries: OverviewEntry[] = [...monthEntries, ...scheduled];
  const summary = totals(monthEntries);
  const query = search.toLowerCase();
  const visibleEntries = calendarEntries.filter((t) =>
    (!day || t.date === day) && (filter === "all" || t.kind === filter) &&
    `${t.title} ${t.note} ${categories.get(t.categoryId)?.name ?? ""} ${accounts.get(t.accountId ?? "")?.name ?? ""}`.toLowerCase().includes(query),
  ).sort((a, b) => b.date.localeCompare(a.date));
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
  return { monthEntries, calendarEntries, summary, visibleEntries, grouped, spending };
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

// Preview only the requested month; browsing never records transactions or advances schedules.
export function scheduledEntries(ledger: Ledger, month: string): OverviewEntry[] {
  const start = `${month}-01`;
  const end = `${month}-${calendarMonth(month).daysInMonth}`;
  const existing = new Set(ledger.transactions.map((t) => t.id));
  const result: OverviewEntry[] = [];
  for (const rule of ledger.recurring) {
    if (!rule.active) continue;
    let date = rule.nextDate;
    while (date <= end) {
      const id = `${rule.id}:${date}`;
      if (date >= start && !existing.has(id)) {
        result.push({ id, title: rule.title, kind: rule.kind, total: rule.total,
          share: rule.share, categoryId: rule.categoryId, accountId: rule.accountId, date, note: rule.note,
          recurringId: rule.id, scheduled: true });
      }
      date = nextOccurrence(date, rule.frequency, rule.anchorDay);
    }
  }
  return result;
}
