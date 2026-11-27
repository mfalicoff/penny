import type { Ledger } from "@domain/ledger.ts";
import { monthReview, type MonthReview } from "@domain/monthReview.ts";
import { useMemo } from "react";
import type { SharedRow } from "../../api/projection";
import { useToday } from "../../app/useToday";
import { useOnline } from "../../design/states";
import { useActivityLedger, useSharedRows, type SharedState } from "../activity/data";
import { ledgerWithShared } from "../home/model";

export interface MonthReviewData {
  /** The ledger with the recorded shared shares of both years joined in; null while it loads. */
  view: Ledger | null;
  /** The recap; null while the ledger or the shared expenses load. */
  review: MonthReview | null;
  /** Shared expenses couldn't load (offline or failed): the recap counts personal entries only. */
  sharedMissing: boolean;
  retry: () => void;
}

const NONE: SharedRow[] = [];
const rowsOf = (state: SharedState): SharedRow[] => (state.status === "ready" ? state.rows : NONE);

/**
 * The recap of `month` (MAZ-292) from the person's ledger view, as the shared rule expects it:
 * personal entries from the same source as Activity and Home, plus the person's recorded shares
 * of shared expenses for the recap's year and the year before
 * (`GET /api/households/projection?year=`), which hold the month before and the same month last
 * year. Scheduled previews never count.
 */
export function useMonthReview(month: string | null): MonthReviewData {
  const online = useOnline();
  const today = useToday();
  const { ledger } = useActivityLedger();
  const year = (month ?? today).slice(0, 4);
  const thisYear = useSharedRows({ type: "year", year }, online);
  const lastYear = useSharedRows({ type: "year", year: String(Number(year) - 1) }, online);
  const loading = thisYear.status === "loading" || lastYear.status === "loading";
  const thisRows = rowsOf(thisYear);
  const lastRows = rowsOf(lastYear);
  const view = useMemo(() => (ledger && !loading ? ledgerWithShared(ledger, [...lastRows, ...thisRows], []) : null), [ledger, loading, thisRows, lastRows]);
  const review = useMemo(() => (view && month ? monthReview(view, month, { today }) : null), [view, month, today]);
  return {
    view,
    review,
    sharedMissing: thisYear.status === "unavailable" || lastYear.status === "unavailable",
    retry: () => {
      thisYear.retry();
      lastYear.retry();
    },
  };
}
