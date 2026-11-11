import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { ledgerCurrencyQuery } from "../../api/ledger";
import { monthRange, searchTransactionsQuery } from "../../api/search";
import type { SearchItem } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { formatCents } from "../../design/Money";
import { useOnline } from "../../design/states";
import { useLedgerSync } from "../../offline/OfflineLedgerProvider";
import type { Ledger } from "@domain/ledger.ts";
import { searchEntries } from "@domain/search.ts";

function describeSearchError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return "This server doesn't offer full search yet. Showing nothing rather than guessing.";
    if (error.status === 429) return "Too many searches. Wait a minute and try again.";
    if (error.status === 503) return "Search is busy. Try again in a moment.";
    if (error.status === 0) return "Penny can't reach the server.";
    if (error.status >= 500) return "Search failed on the server. Try again in a moment.";
    return error.message;
  }
  return "Search failed.";
}

/** Personal entries use the ledger's currency; shared ones use their household's. */
function describe(item: SearchItem, ledgerCurrency: string | undefined) {
  if (item.source === "personal") {
    return { title: item.entry.title, date: item.entry.date, amount: formatCents(item.entry.share, ledgerCurrency), origin: "Personal" };
  }
  return {
    title: item.entry.title,
    date: item.entry.date,
    amount: formatCents(item.entry.shareCents, item.entry.householdCurrency ?? ledgerCurrency),
    origin: item.entry.householdName ? `Shared · ${item.entry.householdName}` : "Shared",
  };
}

/**
 * Search over this browser's ledger (`src/domain/search.ts`: the trimmed, case-insensitive
 * substring rule, newest first). Pending creates and edits are found, pending deletes are not.
 * Personal entries only: shared expenses aren't kept offline.
 */
function LocalSearchResults({ ledger, waiting, query, month }: { ledger: Ledger; waiting: string[]; query: string | undefined; month: string | undefined }) {
  const { from, to } = monthRange(month);
  const pending = new Set(waiting);
  const items = searchEntries(ledger, query ?? "").filter((entry) => (!from || entry.date >= from) && (!to || entry.date <= to));
  return (
    <section aria-label="Search results">
      <p role="status" aria-live="polite">
        {items.length === 0 ? "No matching transactions on this device." : `${items.length} matching transaction${items.length === 1 ? "" : "s"} on this device`}
      </p>
      <p className="muted">Showing what this browser has, including changes waiting to sync. Shared expenses and smarter matching need a connection.</p>
      <ul className="results">
        {items.map((entry) => (
          <li key={`personal:${entry.id}`} className="results__row">
            <span className="results__title">{entry.title}</span>
            <span className="results__meta">
              {pending.has(entry.id) ? "Waiting to sync" : "Personal"} · <time dateTime={entry.date}>{entry.date}</time>
            </span>
            <span className="results__amount pk-num">{formatCents(entry.share, ledger.currency)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SearchResults({ query, month }: { query: string | undefined; month: string | undefined }) {
  const email = useAccountEmail();
  const search = useInfiniteQuery(searchTransactionsQuery(email, { ...(query ? { query } : {}), ...monthRange(month) }));
  const currency = useQuery(ledgerCurrencyQuery(email));
  const sync = useLedgerSync();
  const online = useOnline();

  // Durable offline work (MAZ-87): while changes are pending, offline, or the server's results
  // predate the latest change here, search this browser's ledger instead. Server pages are never
  // mixed with local rows, so a deleted row can't come back and an accepted entry isn't listed twice.
  const localLedger = sync?.ledger ?? null;
  if (sync && localLedger) {
    const stale = search.data !== undefined && search.dataUpdatedAt < sync.changedAt;
    const unreachable = search.data === undefined && search.error instanceof ApiError && search.error.status === 0;
    if (sync.pending.count > 0 || !online || sync.phase === "offline" || stale || unreachable) {
      return <LocalSearchResults ledger={localLedger} waiting={sync.pending.entryIds} query={query} month={month} />;
    }
  }

  if (search.isPending) {
    return (
      <p role="status" aria-live="polite">
        Searching…
      </p>
    );
  }
  if (search.data === undefined) {
    return (
      <div role="alert">
        <p>{describeSearchError(search.error)}</p>
        <button
          type="button"
          className="button"
          onClick={() => {
            void search.refetch();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  const items = search.data.pages.flatMap((page) => page.items);
  const total = search.data.pages[0]?.totalCount ?? 0;
  // A failure after results loaded (a later page or a refresh) never discards them.
  const pageFailed = search.isFetchNextPageError;
  const refreshFailed = search.isRefetchError && !pageFailed;
  return (
    <section aria-label="Search results">
      <p role="status" aria-live="polite">
        {total === 0 ? "No matching transactions." : `${total} matching transaction${total === 1 ? "" : "s"}`}
      </p>
      <ul className="results">
        {items.map((item) => {
          const row = describe(item, currency.data);
          return (
            <li key={item.key} className="results__row">
              <span className="results__title">{row.title}</span>
              <span className="results__meta">
                {row.origin} · <time dateTime={row.date}>{row.date}</time>
              </span>
              <span className="results__amount pk-num">{row.amount}</span>
            </li>
          );
        })}
      </ul>
      {pageFailed || refreshFailed ? (
        <div role="alert">
          <p>{describeSearchError(search.error)}</p>
          <button
            type="button"
            className="button"
            onClick={() => {
              // Only the failed request is repeated: the next page, or one refresh.
              if (pageFailed) void search.fetchNextPage();
              else void search.refetch();
            }}
          >
            {pageFailed ? "Try loading more again" : "Try again"}
          </button>
        </div>
      ) : search.hasNextPage ? (
        <button
          type="button"
          className="button button--secondary"
          aria-disabled={search.isFetchingNextPage}
          onClick={() => {
            if (!search.isFetchingNextPage) void search.fetchNextPage();
          }}
        >
          {search.isFetchingNextPage ? "Loading…" : "Show more"}
        </button>
      ) : null}
    </section>
  );
}
