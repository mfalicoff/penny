import { calendarMonth } from "./calendar.ts";
import { nextOccurrence, totals, type Ledger, type Transaction } from "./ledger.ts";

// A ledger entry or a generated preview. Shared (household) occurrences reach the ledger view
// with `scheduled: true` (see features/households/projection.ts), so the flag is real input.
export type OverviewEntry = Transaction & { scheduled?: boolean };
export type KindTotals = ReturnType<typeof totals>;
// Recorded history excludes scheduled occurrences, including shared ones merged into the view.
export const isRecorded = (entry: Transaction) => !(entry as OverviewEntry).scheduled;

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

// One breakdown of a month, shared by the Overview selector and `summarizeMonth`.
export function monthBreakdown(ledger: Ledger, month: string) {
  const entries: OverviewEntry[] = ledger.transactions.filter((t) => t.date.startsWith(month));
  const recordedEntries = entries.filter(isRecorded);
  // A recorded occurrence replaces its preview. Personal rows match by id only (`rule:date`, as
  // Swift `Recurrence.previews`): an edited entry keeps its recurringId but not its occurrence.
  // Shared rows (recorded and preview ids differ) match by household, rule and date; this needs
  // the server's `recurringId` on recorded rows, so a row without one is never deduplicated.
  const occurrence = (entry: OverviewEntry) => {
    const householdId = "householdId" in entry ? String(entry.householdId ?? "") : "";
    return householdId && entry.recurringId ? `${householdId}|${entry.recurringId}|${entry.date}` : null;
  };
  const recordedIds = new Set(recordedEntries.map((entry) => entry.id));
  const recordedOccurrences = new Set(recordedEntries.map(occurrence).filter((key) => key !== null));
  const scheduled = [...scheduledEntries(ledger, month), ...entries.filter((t) => t.scheduled)].filter((entry) => {
    const key = occurrence(entry);
    return !recordedIds.has(entry.id) && !(key !== null && recordedOccurrences.has(key));
  });
  const scheduledIncome = scheduled.filter((entry) => entry.kind === "income");
  const expectedIncome = scheduledIncome.reduce((sum, entry) => sum + entry.share, 0);
  // Projected adds every scheduled occurrence of the month: income, expenses and investments,
  // personal and shared. (The legacy app added scheduled income only.)
  const summaryEntries: OverviewEntry[] = [...recordedEntries, ...scheduled];
  // The money-flow chart keeps its legacy input: recorded entries plus expected income.
  const moneyFlowEntries: OverviewEntry[] = [...recordedEntries, ...scheduledIncome];
  return { recordedEntries, scheduled, calendarEntries: summaryEntries, expectedIncome, summaryEntries, moneyFlowEntries,
    recorded: totals(recordedEntries), summary: totals(summaryEntries) };
}

export type MonthSummary = {
  recorded: KindTotals;
  /** Scheduled income not yet recorded this month (part of `projected`). */
  expectedIncome: number;
  /** Recorded plus every scheduled occurrence not yet recorded this month (income, expenses, investments). */
  projected: KindTotals;
  /** `net` of each; signed. */
  recordedNet: number;
  projectedNet: number;
};

// Signed income - expense - investment contributions (negative is a deficit). Investment is
// not spending. Money flow's `remaining` is `max(0, net)` and its `gap` is `max(0, -net)`.
export const net = ({ income, expense, investment }: KindTotals) => income - expense - investment;

// Integer cents of personal shares. Never mutates the ledger or advances schedules.
export function summarizeMonth(ledger: Ledger, month: string): MonthSummary {
  const { recorded, summary: projected, expectedIncome } = monthBreakdown(ledger, month);
  return { recorded, expectedIncome, projected, recordedNet: net(recorded), projectedNet: net(projected) };
}
