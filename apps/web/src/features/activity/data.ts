import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { totals, type Kind, type Ledger, type Transaction } from "@domain/ledger.ts";
import { searchLookups, searchMatcher } from "@domain/search.ts";
import { isRecorded, net } from "@domain/summary.ts";
import { ApiError } from "../../api/client";
import { ledgerQuery } from "../../api/ledger";
import { sharedProjectionQuery, type SharedRow } from "../../api/projection";
import { useAccountEmail } from "../../auth/account";
import { useLedgerSync } from "../../offline/OfflineLedgerProvider";
import { parseLedger } from "../../offline/wire";
import { activeDay, inPeriod, periodOf, projectionPeriod, type ActivitySearch, type Period } from "./filters";

/**
 * Activity's inputs (MAZ-88). Personal entries come from this browser's durable ledger (pending
 * changes included), or, in the demo, which stores nothing, from the server's snapshot in Query.
 * Shared rows are the person's shares from `GET /api/households/projection` for the period:
 * online-only, shown from cache while offline, never stored in the offline ledger.
 */
export function useActivityLedger(): { ledger: Ledger | null; local: boolean } {
  const email = useAccountEmail();
  const sync = useLedgerSync();
  const server = useQuery({ ...ledgerQuery(email), enabled: !sync });
  const snapshot = server.data?.ledger;
  return useMemo(() => {
    if (sync) return { ledger: sync.ledger, local: true };
    if (!snapshot) return { ledger: null, local: false };
    try {
      return { ledger: parseLedger(snapshot), local: false };
    } catch {
      return { ledger: null, local: false };
    }
  }, [sync, snapshot]);
}

export type SharedState =
  | { status: "ready"; rows: SharedRow[]; cached: boolean }
  | { status: "loading" }
  /** Offline or unreachable with nothing cached; or another failure. */
  | { status: "unavailable"; message: string }
  /** The server doesn't offer households (the demo, an older server). */
  | { status: "none" };

export function useSharedRows(period: Period, online: boolean): SharedState & { retry: () => void } {
  const email = useAccountEmail();
  const query = useQuery(sharedProjectionQuery(email, projectionPeriod(period)));
  const retry = () => {
    void query.refetch();
  };
  if (query.data) {
    const cached = !online || (query.isError && query.error instanceof ApiError && query.error.status === 0);
    return { status: "ready", rows: query.data.transactions.filter((row) => !row.scheduled && inPeriod(row.date, period)), cached, retry };
  }
  if (query.error instanceof ApiError && query.error.status === 404) return { status: "none", retry };
  if (query.isError) {
    const offline = !online || (query.error instanceof ApiError && query.error.status === 0);
    return { status: "unavailable", message: offline ? "Shared expenses need a connection. They'll appear when Penny reaches the server." : "Shared expenses couldn't load.", retry };
  }
  if (!online) return { status: "unavailable", message: "Shared expenses need a connection. They'll appear when Penny reaches the server.", retry };
  return { status: "loading", retry };
}

export interface PeriodTotals {
  income: number;
  expense: number;
  investment: number;
  net: number;
  /** Your share of shared expenses, already in `expense`. */
  shared: number;
  sharedCount: number;
}

/** Totals of the period: recorded personal shares plus your share of recorded shared expenses. Independent of every other filter. */
export function periodTotals(ledger: Ledger, period: Period, shared: SharedRow[]): PeriodTotals {
  const personal = totals(ledger.transactions.filter((entry) => isRecorded(entry) && inPeriod(entry.date, period)));
  // A household's currency matches its members' ledgers; a row in another currency is never added in.
  const counted = shared.filter((row) => !row.householdCurrency || row.householdCurrency === ledger.currency);
  const sharedTotal = counted.reduce((sum, row) => sum + row.shareCents, 0);
  const result = { ...personal, expense: personal.expense + sharedTotal };
  return { ...result, net: net(result), shared: sharedTotal, sharedCount: counted.length };
}

export type ActivityRow =
  | { key: string; source: "personal"; date: string; entry: Transaction; pending: boolean }
  | { key: string; source: "shared"; date: string; entry: SharedRow };

export const byDateThenKey = (a: ActivityRow, b: ActivityRow) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key);

export interface RowFilters {
  query: string;
  period: Period;
  day: string | undefined;
  kind: Kind | undefined;
  category: string | undefined;
}

export function rowFilters(search: ActivitySearch): RowFilters {
  return { query: search.q ?? "", period: periodOf(search), day: activeDay(search), kind: search.kind, category: search.category };
}

/** The category's name, which is how a shared row (sent by value) matches a personal category filter. */
export function categoryName(ledger: Ledger | null, id: string | undefined): string | undefined {
  return id ? ledger?.categories.find((category) => category.id === id)?.name : undefined;
}

/**
 * Activity from what this browser has: personal entries (the shared substring rule over title,
 * note, category and account, `src/domain/search.ts`) and cached shared rows (title, note, category
 * and household), newest first with a stable tie-break. Pending creates and edits are found,
 * pending deletes are not, and nothing from an older server page can bring a deleted row back.
 */
export function localRows(ledger: Ledger, shared: SharedRow[], filters: RowFilters, pending: ReadonlySet<string>): ActivityRow[] {
  const matches = searchMatcher(filters.query, searchLookups(ledger));
  const sharedCategory = categoryName(ledger, filters.category);
  const personal: ActivityRow[] = ledger.transactions
    .filter(
      (entry) =>
        isRecorded(entry) &&
        inPeriod(entry.date, filters.period) &&
        (!filters.day || entry.date === filters.day) &&
        (!filters.kind || entry.kind === filters.kind) &&
        (!filters.category || entry.categoryId === filters.category) &&
        matches(entry),
    )
    .map((entry) => ({ key: `personal:${entry.id}`, source: "personal", date: entry.date, entry, pending: pending.has(entry.id) }));
  const needle = filters.query.trim().toLowerCase();
  const sharedRows: ActivityRow[] =
    filters.kind && filters.kind !== "expense"
      ? []
      : shared
          .filter(
            (row) =>
              (!filters.day || row.date === filters.day) &&
              (!filters.category || row.category.name === sharedCategory) &&
              `${row.title} ${row.note} ${row.category.name} ${row.householdName ?? ""}`.toLowerCase().includes(needle),
          )
          .map((row) => ({ key: `shared:${row.id}`, source: "shared", date: row.date, entry: row }));
  return [...personal, ...sharedRows].sort(byDateThenKey);
}
