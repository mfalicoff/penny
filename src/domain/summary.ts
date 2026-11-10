import { totals, type Ledger } from "./ledger.ts";
import { scheduledEntries, type OverviewEntry } from "./selectors/overview.ts";

export type KindTotals = ReturnType<typeof totals>;
export type MonthSummary = {
  /** Recorded entries dated in the month (scheduled previews excluded). */
  recorded: KindTotals;
  /** Scheduled income not yet recorded this month; scheduled expenses and investments never count. */
  expectedIncome: number;
  /** Recorded plus expected income. Expenses and investments are always recorded-only. */
  projected: KindTotals;
  /** income - expense - investment, signed (negative is a deficit). Investment is not spending. */
  recordedRemaining: number;
  projectedRemaining: number;
};

export const remaining = ({ income, expense, investment }: KindTotals) => income - expense - investment;

// Integer cents of personal shares. Never mutates the ledger or advances schedules.
export function summarizeMonth(ledger: Ledger, month: string): MonthSummary {
  const entries: OverviewEntry[] = ledger.transactions.filter((entry) => entry.date.startsWith(month));
  const recorded = totals(entries.filter((entry) => !entry.scheduled));
  const scheduled = [...scheduledEntries(ledger, month), ...entries.filter((entry) => entry.scheduled)];
  const expectedIncome = scheduled.filter((entry) => entry.kind === "income").reduce((sum, entry) => sum + entry.share, 0);
  const projected = { ...recorded, income: recorded.income + expectedIncome };
  return { recorded, expectedIncome, projected, recordedRemaining: remaining(recorded), projectedRemaining: remaining(projected) };
}
