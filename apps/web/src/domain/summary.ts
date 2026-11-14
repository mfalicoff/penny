import { calendarMonth } from "./calendar.ts";
import { nextOccurrence, totals, type Ledger, type Transaction } from "./ledger.ts";

// A ledger entry or a generated preview. Shared (household) occurrences reach the ledger view
// with `scheduled: true` (see features/households/projection.ts), so the flag is real input.
export type OverviewEntry = Transaction & { scheduled?: boolean };
export type KindTotals = ReturnType<typeof totals>;
// Recorded history excludes scheduled occurrences, including shared ones merged into the view.
export const isRecorded = (entry: Transaction) => !(entry as OverviewEntry).scheduled;

/** Options of a month breakdown. */
export type MonthOptions = {
  /**
   * The person's local calendar date (`dateKey()` on the device, or `dateKeyIn` for a known time
   * zone). Income dated after today is expected (MAZ-136): it counts toward Projected, not
   * toward recorded totals or Left to spend, until its date arrives.
   */
  today: string;
};

// MAZ-136: a ledger entry is expected rather than recorded when it is income dated after today.
// The entry itself never changes; on its date it moves from Projected to Left to spend. Income
// only: future-dated expenses and investment contributions stay recorded (MAZ-139 owns those).
export const isExpectedIncome = (entry: Transaction, today: string) =>
  isRecorded(entry) && entry.kind === "income" && entry.date > today;

/** Not counted in Left to spend yet: a scheduled preview, or income dated after today. */
export const isExpected = (entry: Transaction, today: string) =>
  !isRecorded(entry) || isExpectedIncome(entry, today);

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
export function monthBreakdown(ledger: Ledger, month: string, { today }: MonthOptions) {
  const entries: OverviewEntry[] = ledger.transactions.filter((t) => t.date.startsWith(month));
  // Every ledger row dated in the month. Income dated after today is expected, not recorded.
  const dated = entries.filter(isRecorded);
  const recordedEntries = dated.filter((entry) => !isExpectedIncome(entry, today));
  const expected = dated.filter((entry) => isExpectedIncome(entry, today));
  // A recorded occurrence replaces its preview. Personal rows match by id only (`rule:date`, as
  // Swift `Recurrence.previews`): an edited entry keeps its recurringId but not its occurrence.
  // Shared rows (recorded and preview ids differ) match by household, rule and date; this needs
  // the server's `recurringId` on recorded rows, so a row without one is never deduplicated.
  // An expected entry is still a ledger row, so it replaces its preview too.
  const occurrence = (entry: OverviewEntry) => {
    const householdId = "householdId" in entry ? String(entry.householdId ?? "") : "";
    return householdId && entry.recurringId ? `${householdId}|${entry.recurringId}|${entry.date}` : null;
  };
  const recordedIds = new Set(dated.map((entry) => entry.id));
  const recordedOccurrences = new Set(dated.map(occurrence).filter((key) => key !== null));
  const scheduled = [...scheduledEntries(ledger, month), ...entries.filter((t) => t.scheduled)].filter((entry) => {
    const key = occurrence(entry);
    return !recordedIds.has(entry.id) && !(key !== null && recordedOccurrences.has(key));
  });
  const scheduledIncome = scheduled.filter((entry) => entry.kind === "income");
  const expectedIncome = [...expected, ...scheduledIncome].reduce((sum, entry) => sum + entry.share, 0);
  // Projected adds every scheduled occurrence of the month (income, expenses and investments,
  // personal and shared) and income dated after today.
  const summaryEntries: OverviewEntry[] = [...recordedEntries, ...expected, ...scheduled];
  return { recordedEntries, expected, scheduled, calendarEntries: summaryEntries, expectedIncome, summaryEntries,
    recorded: totals(recordedEntries), summary: totals(summaryEntries) };
}

export type MonthSummary = {
  recorded: KindTotals;
  /**
   * Income not in Left to spend yet (part of `projected`): scheduled income not recorded this
   * month, plus income dated after `today` (MAZ-136).
   */
  expectedIncome: number;
  /**
   * Recorded plus every scheduled occurrence not yet recorded this month (income, expenses,
   * investments) and income dated after `today`.
   */
  projected: KindTotals;
  /** `net` of each; signed. */
  recordedNet: number;
  projectedNet: number;
};

// Signed income - expense - investment contributions (negative is a deficit). Investment is
// not spending. Money flow's `remaining` is `max(0, net)` and its `gap` is `max(0, -net)`.
export const net = ({ income, expense, investment }: KindTotals) => income - expense - investment;

// Integer cents of personal shares. Never mutates the ledger or advances schedules.
export function summarizeMonth(ledger: Ledger, month: string, options: MonthOptions): MonthSummary {
  const { recorded, summary: projected, expectedIncome } = monthBreakdown(ledger, month, options);
  return { recorded, expectedIncome, projected, recordedNet: net(recorded), projectedNet: net(projected) };
}
