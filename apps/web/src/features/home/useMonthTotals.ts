import { useQueries } from "@tanstack/react-query";
import { sharedProjectionQuery, type SharedRow } from "../../api/projection";
import { useAccountEmail } from "../../auth/account";
import { useToday } from "../../app/useToday";
import { periodTotals, useActivityLedger } from "../activity/data";
import { inPeriod } from "../activity/filters";

export interface MonthTotals {
  month: string;
  /** Recorded income (income dated after today is expected, so not yet in). */
  income: number;
  /** Recorded spending at your share, shared expenses included. */
  spent: number;
}

/**
 * Recorded income and spending of each month, for Insights' six-month chart (card `web-insights`).
 * The same totals as Activity's and Home's: personal entries from the durable ledger plus your
 * share of each month's recorded shared expenses (`GET /api/households/projection?month=`, the
 * queries Home and Insights already use). A month whose shared rows can't load counts personal
 * entries only, as Home does. Null until the ledger and every reachable month have loaded.
 */
export function useMonthTotals(months: readonly string[]): MonthTotals[] | null {
  const email = useAccountEmail();
  const { ledger } = useActivityLedger();
  const today = useToday();
  const shared = useQueries({
    queries: months.map((month) => sharedProjectionQuery(email, { month })),
    combine: (results) => ({
      // A paused query (offline) won't settle; count it as unavailable rather than wait.
      settled: results.every((result) => !result.isPending || result.fetchStatus === "paused"),
      data: results.map((result) => result.data),
    }),
  });
  if (!ledger || !shared.settled) return null;
  return months.map((month, index) => {
    const period = { type: "month", month } as const;
    const rows: SharedRow[] = (shared.data[index]?.transactions ?? []).filter((row) => !row.scheduled && inPeriod(row.date, period));
    const totals = periodTotals(ledger, period, rows, today);
    return { month, income: totals.income, spent: totals.expense };
  });
}
