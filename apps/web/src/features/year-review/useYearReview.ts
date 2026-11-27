import type { Household } from "@domain/householdProjection.ts";
import type { Ledger } from "@domain/ledger.ts";
import { yearReview, type YearReview } from "@domain/yearReview.ts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { householdsQuery } from "../../api/households";
import type { SharedRow } from "../../api/projection";
import { useAccountEmail } from "../../auth/account";
import { useToday } from "../../app/useToday";
import { useOnline } from "../../design/states";
import { useActivityLedger, useSharedRows } from "../activity/data";
import { ledgerWithShared } from "../home/model";

export interface YearReviewData {
  /** The ledger with the year's recorded shared shares joined in; null while it loads. */
  view: Ledger | null;
  /** The year in review; null while the ledger, the shared expenses or the households load. */
  review: YearReview | null;
  /** The person's households, for trip and household names (never on the share image). */
  households: readonly ReviewHousehold[];
  /** Shared expenses or households couldn't load (offline or failed): the year counts personal entries only. */
  sharedMissing: boolean;
  retry: () => void;
}

/** What the year in review reads of a household: its name (for the page only), members and trip. */
export type ReviewHousehold = Pick<Household, "id" | "name" | "memberCount" | "trip">;

const NONE: SharedRow[] = [];
const NO_HOUSEHOLDS: ReviewHousehold[] = [];

/**
 * The year in review of `year` (MAZ-292 phase 2) from the person's ledger view, as the shared rule
 * expects it: personal entries from the same source as Activity and Home, plus the person's
 * recorded shares of shared expenses in the year (`GET /api/households/projection?year=`), joined
 * as `useMonthReview` does. The households list (`GET /api/households`) gives the shared trips and
 * the member counts. Scheduled previews never count.
 */
export function useYearReview(year: string): YearReviewData {
  const online = useOnline();
  const today = useToday();
  const email = useAccountEmail();
  const { ledger } = useActivityLedger();
  const shared = useSharedRows({ type: "year", year }, online);
  const list = useQuery(householdsQuery(email));
  // The demo and people with no household answer 404 for the projection: nothing is missing then.
  const householdsSettled = !list.isPending || shared.status === "none";
  const loading = shared.status === "loading" || !householdsSettled;
  const rows = shared.status === "ready" ? shared.rows : NONE;
  const data = list.data;
  const households = useMemo<readonly ReviewHousehold[]>(
    () => data?.map(({ id, name, memberCount, trip }) => (trip ? { id, name, memberCount, trip } : { id, name, memberCount })) ?? NO_HOUSEHOLDS,
    [data],
  );
  const view = useMemo(() => (ledger && !loading ? ledgerWithShared(ledger, rows, []) : null), [ledger, loading, rows]);
  const review = useMemo(() => (view ? yearReview(view, year, { today, households }) : null), [view, year, today, households]);
  return {
    view,
    review,
    households,
    sharedMissing: shared.status === "unavailable" || (shared.status !== "none" && list.isError),
    retry: () => {
      shared.retry();
      void list.refetch();
    },
  };
}

/** Whether `year` has a recorded entry, personal or shared, for the January banner. Null while it loads. */
export function useHasYear(year: string): boolean | null {
  const today = useToday();
  const online = useOnline();
  const { ledger } = useActivityLedger();
  const shared = useSharedRows({ type: "year", year }, online);
  const rows = shared.status === "ready" ? shared.rows : null;
  const settled = shared.status !== "loading";
  return useMemo(() => {
    if (!ledger || !settled) return null;
    return !yearReview(ledgerWithShared(ledger, rows ?? [], []), year, { today, households: [] }).empty;
  }, [ledger, rows, settled, year, today]);
}
