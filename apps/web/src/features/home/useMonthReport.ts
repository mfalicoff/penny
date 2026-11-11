import type { Ledger } from "@domain/ledger.ts";
import { useMemo } from "react";
import { useOnline } from "../../design/states";
import { useActivityLedger, useSharedRows, type SharedState } from "../activity/data";
import { ledgerWithShared, monthReport, type MonthReport } from "./model";

export interface MonthData {
  /** This browser's ledger (or the demo's snapshot); null while it loads. */
  ledger: Ledger | null;
  /** The ledger with the month's shared shares and previews joined in (read-only). */
  view: Ledger | null;
  report: MonthReport | null;
  shared: SharedState & { retry: () => void };
}

/**
 * One month for Home and Insights: personal entries from the same source as Activity (the
 * durable offline ledger, or the demo's snapshot) and the person's shared shares and previews
 * from `GET /api/households/projection?month=`, joined into a view and reported by the shared
 * domain. Memoized on its inputs, so typing in the list's search never recomputes the totals.
 */
export function useMonthReport(month: string): MonthData {
  const online = useOnline();
  const { ledger } = useActivityLedger();
  const shared = useSharedRows({ type: "month", month }, online);
  const rows = shared.status === "ready" ? shared.rows : null;
  const scheduled = shared.status === "ready" ? shared.scheduled : null;
  const view = useMemo(() => (ledger ? ledgerWithShared(ledger, rows ?? [], scheduled ?? []) : null), [ledger, rows, scheduled]);
  const report = useMemo(() => (view ? monthReport(view, month) : null), [view, month]);
  return { ledger, view, report, shared };
}
