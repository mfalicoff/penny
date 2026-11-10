import { infiniteQueryOptions, type QueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { userKey } from "./keys";
import { searchResponseSchema, type SearchRequest } from "./schemas";

/** Everything that selects results. Paging is separate: the cursor is the page parameter, not part of the key. */
export type SearchFilters = Omit<SearchRequest, "cursor" | "pageSize">;

const PAGE_SIZE = 50;

/** One canonical shape per search, so equal searches share a cache entry whatever order the fields were set in. */
export function normalizeFilters(filters: SearchFilters): SearchFilters {
  const query = filters.query?.trim();
  return {
    ...(query ? { query } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.source ? { source: filters.source } : {}),
    ...(filters.sort ? { sort: filters.sort } : {}),
  };
}

/** First and last calendar day of a `YYYY-MM` month, or an empty filter. */
export function monthRange(month: string | undefined): Pick<SearchFilters, "from" | "to"> {
  const match = month ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month) : null;
  if (!match) return {};
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${match[1]}-${match[2]}-01`, to: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * Search v1 (MAZ-121), one page at a time. The key holds the account, the filters and the
 * query text, so changing any of them (or the account) is a different cache entry; the
 * cursor travels as the page parameter and the server rejects a cursor from another query.
 * The request is aborted when the key changes or the component unmounts, and a response
 * for an older key can only land in that older entry, never in the one on screen.
 */
export function searchTransactionsQuery(email: string, filters: SearchFilters) {
  const normalized = normalizeFilters(filters);
  return infiniteQueryOptions({
    queryKey: userKey(email, "search", "transactions", normalized),
    queryFn: ({ pageParam, signal }) =>
      apiFetch("/api/v1/search/transactions", searchResponseSchema, {
        method: "POST",
        body: { ...normalized, pageSize: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}

/**
 * Call after a mutation that changes what search can return (ledger saves, shared expense
 * changes, joining or leaving a household). Marks the account's search results stale and
 * refetches the ones on screen. Durable offline edits are not in Query, so they are never
 * touched here.
 */
export function invalidateSearch(queryClient: QueryClient, email: string): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: userKey(email, "search") });
}
