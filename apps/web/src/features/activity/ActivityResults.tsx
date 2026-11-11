import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { Ledger, Transaction } from "@domain/ledger.ts";
import { ApiError } from "../../api/client";
import { ledgerCurrencyQuery } from "../../api/ledger";
import { searchTransactionsQuery } from "../../api/search";
import { useAccountEmail } from "../../auth/account";
import { Button } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { Money } from "../../design/Money";
import { EmptyState, useOnline } from "../../design/states";
import { useLedgerSync } from "../../offline/OfflineLedgerProvider";
import { dayLabel } from "../households/model";
import { categoryIcon } from "../entries/model";
import { categoryName, localRows, type ActivityRow, type RowFilters, type SharedState } from "./data";
import type { ActivitySearch } from "./filters";
import { searchRange } from "./filters";

const PAGE = 50;

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

const plural = (count: number) => `${String(count)} matching transaction${count === 1 ? "" : "s"}`;

interface ResultsProps {
  search: ActivitySearch;
  filters: RowFilters;
  ledger: Ledger | null;
  shared: SharedState;
  onOpen: (entry: Transaction, opener: HTMLElement) => void;
}

/**
 * Activity's list (specimens `activity`, `activity-expenses`, `search-empty`, `offline`). Online
 * and up to date, it is MAZ-121's server search (personal and shared rows, typo and meaning
 * matches, cursor pages). While changes are pending, offline, or when the server's results predate
 * the latest change here, it lists this browser's ledger and the cached shared rows instead and says
 * so. Server pages are never mixed with local rows, so a deleted row can't come back and an
 * accepted entry isn't listed twice. Personal rows open their detail; shared rows open the expense
 * in its household.
 */
export function ActivityResults({ search, filters, ledger, shared, onOpen }: ResultsProps) {
  const email = useAccountEmail();
  const range = searchRange(search);
  const serverSearch = useInfiniteQuery(
    searchTransactionsQuery(email, { ...(filters.query ? { query: filters.query } : {}), ...range, ...(filters.kind ? { kind: filters.kind } : {}) }),
  );
  const currency = useQuery(ledgerCurrencyQuery(email));
  const sync = useLedgerSync();
  const online = useOnline();
  const [limit, setLimit] = useState(PAGE);

  const localLedger = sync?.ledger ?? null;
  if (sync && localLedger) {
    const stale = serverSearch.data !== undefined && serverSearch.dataUpdatedAt < sync.changedAt;
    const unreachable = serverSearch.data === undefined && serverSearch.error instanceof ApiError && serverSearch.error.status === 0;
    if (sync.pending.count > 0 || !online || sync.phase === "offline" || stale || unreachable) {
      const pending = new Set(sync.pending.entryIds);
      const sharedRows = shared.status === "ready" ? shared.rows : [];
      const rows = localRows(localLedger, sharedRows, filters, pending);
      return (
        <section aria-label="Search results" className="activity-results">
          <p role="status" aria-live="polite">
            {rows.length === 0 ? "No matching transactions on this device." : `${plural(rows.length)} on this device`}
          </p>
          <p className="note">
            Showing what this browser has, including changes waiting to sync.{" "}
            {shared.status === "ready" ? "Shared expenses are as Penny last loaded them; smarter matching needs a connection." : "Shared expenses and smarter matching need a connection."}
          </p>
          {rows.length === 0 ? <NoResults query={filters.query} /> : null}
          <RowList rows={rows.slice(0, limit)} ledger={localLedger} currency={localLedger.currency} onOpen={onOpen} />
          {rows.length > limit ? (
            <Button variant="secondary" onClick={() => { setLimit((value) => value + PAGE); }}>
              Show more
            </Button>
          ) : null}
        </section>
      );
    }
  }

  if (serverSearch.isPending) {
    return (
      <p role="status" aria-live="polite">
        Searching…
      </p>
    );
  }
  if (serverSearch.data === undefined) {
    return (
      <div role="alert">
        <p>{describeSearchError(serverSearch.error)}</p>
        <Button
          variant="primary"
          onClick={() => {
            void serverSearch.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  const sharedCategory = categoryName(ledger, filters.category);
  const rows: ActivityRow[] = serverSearch.data.pages
    .flatMap((page) => page.items)
    .flatMap((item): ActivityRow[] => {
      if (item.source === "personal") {
        // The ledger's copy is the newer one when it has the entry; Activity shows that.
        const entry: Transaction = localLedger?.transactions.find((value) => value.id === item.entry.id) ?? (JSON.parse(JSON.stringify(item.entry)) as Transaction);
        if (filters.category && entry.categoryId !== filters.category) return [];
        return [{ key: item.key, source: "personal", date: entry.date, entry, pending: false }];
      }
      if (filters.category && item.entry.category.name !== sharedCategory) return [];
      return [{ key: item.key, source: "shared", date: item.entry.date, entry: item.entry }];
    });
  // The category filter is applied to loaded pages, so its count is what has loaded so far.
  const total = filters.category ? rows.length : (serverSearch.data.pages[0]?.totalCount ?? 0);
  const pageFailed = serverSearch.isFetchNextPageError;
  const refreshFailed = serverSearch.isRefetchError && !pageFailed;
  return (
    <section aria-label="Search results" className="activity-results">
      <p role="status" aria-live="polite">
        {total === 0 && !serverSearch.hasNextPage ? "No matching transactions." : `${plural(total)}${filters.category && serverSearch.hasNextPage ? " so far" : ""}`}
      </p>
      {total === 0 && !serverSearch.hasNextPage ? <NoResults query={filters.query} /> : null}
      <RowList rows={rows} ledger={localLedger ?? ledger} currency={currency.data} onOpen={onOpen} />
      {pageFailed || refreshFailed ? (
        <div role="alert">
          <p>{describeSearchError(serverSearch.error)}</p>
          <Button
            variant="secondary"
            onClick={() => {
              // Only the failed request is repeated: the next page, or one refresh.
              if (pageFailed) void serverSearch.fetchNextPage();
              else void serverSearch.refetch();
            }}
          >
            {pageFailed ? "Try loading more again" : "Try again"}
          </Button>
        </div>
      ) : serverSearch.hasNextPage ? (
        <Button
          variant="secondary"
          busy={serverSearch.isFetchingNextPage}
          onClick={() => {
            void serverSearch.fetchNextPage();
          }}
        >
          {serverSearch.isFetchingNextPage ? "Loading…" : "Show more"}
        </Button>
      ) : null}
    </section>
  );
}

function NoResults({ query }: { query: string }) {
  return query ? (
    <EmptyState icon="search" title={`Nothing matches “${query}”`}>
      Try fewer or different words, another period, or All categories.
    </EmptyState>
  ) : (
    <EmptyState icon="list" title="Nothing here yet">
      Entries for this period and filter show up here. Add one with Add entry.
    </EmptyState>
  );
}

const TONE = { expense: "expense", income: "income", investment: "investment" } as const;

/** One keyboard-reachable row per entry: a button for personal entries, a link for shared ones. */
function RowList({ rows, ledger, currency, onOpen }: { rows: ActivityRow[]; ledger: Ledger | null; currency: string | undefined; onOpen: ResultsProps["onOpen"] }) {
  if (rows.length === 0) return null;
  const categories = new Map(ledger?.categories.map((category) => [category.id, category]));
  const accounts = new Map(ledger?.accounts.map((account) => [account.id, account.name]));
  return (
    <ul className="results">
      {rows.map((row) => {
        if (row.source === "personal") {
          const { entry } = row;
          const category = categories.get(entry.categoryId);
          const account = entry.accountId ? accounts.get(entry.accountId) : undefined;
          return (
            <li key={row.key} className="results__row activity-row">
              <button
                type="button"
                className="activity-row__main"
                data-row-key={row.key}
                onClick={(event) => {
                  onOpen(entry, event.currentTarget);
                }}
              >
                <span className="category-dot" style={{ color: category?.color }}>
                  <Icon name={categoryIcon(category?.icon)} size={18} />
                </span>
                <span className="results__title">{entry.title}</span>
                <span className="results__meta">
                  {row.pending ? "Waiting to sync" : "Personal"}
                  {category ? ` · ${category.name}` : ""}
                  {account ? ` · ${account}` : ""} · <time dateTime={entry.date}>{dayLabel(entry.date, true)}</time>
                </span>
                <span className="results__amount">
                  <Money cents={entry.share} currency={currency} tone={TONE[entry.kind]} />
                </span>
              </button>
            </li>
          );
        }
        const { entry } = row;
        return (
          <li key={row.key} className="results__row activity-row">
            <Link to="/households/$id/expenses/$expenseId" params={{ id: entry.householdId, expenseId: entry.id }} className="activity-row__main">
              <span className="category-dot" style={{ color: entry.category.color }}>
                <Icon name={categoryIcon(entry.category.icon)} size={18} />
              </span>
              <span className="results__title">{entry.title}</span>
              <span className="results__meta">
                {entry.householdName ? `Shared · ${entry.householdName}` : "Shared"} · {entry.category.name} · <time dateTime={entry.date}>{dayLabel(entry.date, true)}</time>
              </span>
              <span className="results__amount">
                <Money cents={entry.shareCents} currency={entry.householdCurrency ?? currency} />
                <span className="results__sub">your share</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
