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
  const scheduled = [...scheduledEntries(ledger, month), ...entries.filter((t) => t.scheduled)];
  const scheduledIncome = scheduled.filter((entry) => entry.kind === "income");
  const expectedIncome = scheduledIncome.reduce((sum, entry) => sum + entry.share, 0);
  // Projection adds scheduled income only; scheduled expenses and investments never count.
  const summaryEntries: OverviewEntry[] = [...recordedEntries, ...scheduledIncome];
  return { recordedEntries, scheduled, calendarEntries: [...recordedEntries, ...scheduled] as OverviewEntry[], expectedIncome, summaryEntries, summary: totals(summaryEntries) };
}

export type MonthSummary = {
  recorded: KindTotals;
  /** Scheduled income not yet recorded this month. */
  expectedIncome: number;
  /** Recorded plus expected income; expenses and investments stay recorded-only. */
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
  const { recordedEntries, summary: projected, expectedIncome } = monthBreakdown(ledger, month);
  const recorded = totals(recordedEntries);
  return { recorded, expectedIncome, projected, recordedNet: net(recorded), projectedNet: net(projected) };
}
