import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { Ledger, Transaction } from "@domain/ledger.ts";
import { isExpectedIncome } from "@domain/summary.ts";
import { ApiError } from "../../api/client";
import { useToday } from "../../app/useToday";
import { ledgerCurrencyQuery } from "../../api/ledger";
import { searchTransactionsQuery } from "../../api/search";
import { useAccountEmail } from "../../auth/account";
import { Button } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { tileStyle } from "../../design/categoryTint";
import { Money } from "../../design/Money";
import { EmptyState, useOnline } from "../../design/states";
import { useLedgerSync } from "../../offline/OfflineLedgerProvider";
import { dayLabel } from "../households/model";
import { categoryIcon } from "../entries/model";
import { rowAmount } from "../recurring/model";
import { categoryName, dayTotal, groupByDay, localRows, type ActivityRow, type RowFilters, type SharedState } from "./data";
import type { ActivitySearch } from "./filters";
import { activeDay, KIND_FILTERS, periodLabel, periodOf, searchRange } from "./filters";

const PAGE = 50;

function describeSearchError(error: unknown): string {
  if (error instanceof ApiError) {
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
  /** Drops these search parameters (the empty state's "Search all time" and "Clear filters"). */
  onClear: (...keys: (keyof ActivitySearch)[]) => void;
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
export function ActivityResults({ search, filters, ledger, shared, onOpen, onClear }: ResultsProps) {
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
          {rows.length === 0 ? <NoResults search={search} onClear={onClear} /> : null}
          <RowList rows={rows.slice(0, limit)} grouped={!filters.query} complete={rows.length <= limit} ledger={localLedger} currency={localLedger.currency} onOpen={onOpen} />
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
      {total === 0 && !serverSearch.hasNextPage ? <NoResults search={search} onClear={onClear} /> : null}
      {/* A search with words is ranked by relevance, not date, so only browsing is grouped by day. */}
      <RowList rows={rows} grouped={!filters.query} complete={!serverSearch.hasNextPage} ledger={localLedger ?? ledger} currency={currency.data} onOpen={onOpen} />
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

/**
 * Nothing matches (`iphone-search-empty`): centered in the results area, it names the search and
 * where it looked, and offers to look in every period or to drop the filters.
 */
function NoResults({ search, onClear }: { search: ActivitySearch; onClear: ResultsProps["onClear"] }) {
  const period = periodOf(search);
  const day = activeDay(search);
  const kind = KIND_FILTERS.find((option) => option.value === search.kind)?.label.toLowerCase();
  const scope = [day ? dayLabel(day, true) : period.type === "all" ? "" : periodLabel(period), kind ?? ""].filter(Boolean).join(" ");
  const limited = period.type !== "all" || search.day !== undefined;
  const filtered = Boolean(search.kind || search.category || search.day);
  const actions =
    limited || filtered ? (
      <div className="state__actions">
        {limited ? (
          <Button variant="primary" icon="search" onClick={() => { onClear("month", "year", "day"); }}>
            Search all time
          </Button>
        ) : null}
        {filtered ? (
          <Button variant="secondary" onClick={() => { onClear("kind", "category", "day"); }}>
            Clear filters
          </Button>
        ) : null}
      </div>
    ) : null;
  return search.q ? (
    <EmptyState icon="search" title={`No results for “${search.q}”`} action={actions}>
      {scope ? `Nothing matches in ${scope}.` : "Nothing matches."} Try another word{limited || filtered ? ", or search everything" : ""}.
    </EmptyState>
  ) : (
    <EmptyState icon="list" title="Nothing here yet" action={actions}>
      Entries for this period and filter show up here. Add one with Add entry.
    </EmptyState>
  );
}

const TONE = { expense: "expense", income: "income", investment: "investment" } as const;

/** The day header: Today, Yesterday, or the weekday and date (with the year when it isn't this year's). */
function dayHeading(date: string, today: string): string {
  if (date === today) return "Today";
  const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  const [todayYear = 2000, todayMonth = 1, todayDay = 1] = today.split("-").map(Number);
  if (Date.UTC(todayYear, todayMonth - 1, todayDay) - value.getTime() === 86_400_000) return "Yesterday";
  return value.toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric", ...(date.startsWith(today.slice(0, 4)) ? {} : { year: "numeric" }), timeZone: "UTC" });
}

interface RowListProps {
  rows: ActivityRow[];
  /** Rows are in date order: show them in day sections with each day's total. */
  grouped: boolean;
  /** Every matching row is listed; otherwise the last day may continue on the next page and gets no total. */
  complete: boolean;
  ledger: Ledger | null;
  currency: string | undefined;
  onOpen: ResultsProps["onOpen"];
}

/**
 * One keyboard-reachable row per entry: a button for personal entries, a link for shared ones.
 * Browsing lists them by day (`iphone-activity`, `web-activity`): a heading with the day's total,
 * then that day's rows on one surface.
 */
function RowList({ rows, grouped, complete, ledger, currency, onOpen }: RowListProps) {
  const today = useToday();
  if (rows.length === 0) return null;
  const categories = new Map(ledger?.categories.map((category) => [category.id, category]));
  const accounts = new Map(ledger?.accounts.map((account) => [account.id, account.name]));
  const row = (item: ActivityRow) => <Row key={item.key} row={item} grouped={grouped} categories={categories} accounts={accounts} currency={currency} today={today} onOpen={onOpen} />;
  if (!grouped) return <ul className="results">{rows.map(row)}</ul>;
  const groups = groupByDay(rows);
  return (
    <div className="day-groups">
      {groups.map((group, index) => {
        const total = complete || index < groups.length - 1 ? dayTotal(group.rows, currency, today) : null;
        return (
          <div key={group.date} className="day-group">
            <div className="day-group__head">
              <h2 className="day-group__title">
                <time dateTime={group.date}>{dayHeading(group.date, today)}</time>
              </h2>
              {total ? (
                <span className="day-group__total">
                  <span className="visually-hidden">Day total </span>
                  <Money cents={total.cents} currency={total.currency} tone={total.cents > 0 ? "income" : "expense"} signed />
                </span>
              ) : null}
            </div>
            <ul className="results day-group__rows">{group.rows.map(row)}</ul>
          </div>
        );
      })}
    </div>
  );
}

function Row({
  row,
  grouped,
  categories,
  accounts,
  currency,
  today,
  onOpen,
}: {
  row: ActivityRow;
  /** Under a day heading the date is only read out, not shown again. */
  grouped: boolean;
  categories: Map<string, Ledger["categories"][number]>;
  accounts: Map<string, string>;
  currency: string | undefined;
  today: string;
  onOpen: ResultsProps["onOpen"];
}) {
  if (row.source === "personal") {
    const { entry } = row;
    const category = categories.get(entry.categoryId);
    const account = entry.accountId ? accounts.get(entry.accountId) : undefined;
    // MAZ-136: income dated after today is expected; it counts toward Projected, not Left to spend.
    const expected = isExpectedIncome(entry, today);
    return (
      <li className="results__row activity-row">
        <button
          type="button"
          className="activity-row__main"
          data-row-key={row.key}
          onClick={(event) => {
            onOpen(entry, event.currentTarget);
          }}
        >
          <span className={expected ? "category-dot category-dot--expected" : "category-dot"} style={tileStyle({ ...category, entryKind: entry.kind })}>
            <Icon name={categoryIcon(category?.icon)} size={18} />
          </span>
          <span className="results__title">{entry.title}</span>
          <span className="results__meta">
            {row.pending ? "Waiting to sync" : "Personal"}
            {expected ? " · Expected" : ""}
            {category ? ` · ${category.name}` : ""}
            {account ? ` · ${account}` : ""}
            <span className={grouped ? "visually-hidden" : undefined}>
              {" · "}
              <time dateTime={entry.date}>{dayLabel(entry.date, true)}</time>
            </span>
          </span>
          <span className="results__amount">
            {/* MAZ-202: recorded rows read as the cards do (expenses −, income +); expected income stays unsigned. */}
            {expected ? <Money cents={entry.share} currency={currency} tone="pending" /> : <Money {...rowAmount(entry.kind, entry.share)} currency={currency} tone={TONE[entry.kind]} />}
          </span>
        </button>
      </li>
    );
  }
  const { entry } = row;
  return (
    <li className="results__row activity-row">
      <Link to="/households/$id/expenses/$expenseId" params={{ id: entry.householdId, expenseId: entry.id }} className="activity-row__main">
        <span className="category-dot" style={tileStyle(entry.category)}>
          <Icon name={categoryIcon(entry.category.icon)} size={18} />
        </span>
        <span className="results__title">{entry.title}</span>
        <span className="results__meta">
          {entry.householdName ? `Shared · ${entry.householdName}` : "Shared"} · {entry.category.name}
          <span className={grouped ? "visually-hidden" : undefined}>
            {" · "}
            <time dateTime={entry.date}>{dayLabel(entry.date, true)}</time>
          </span>
        </span>
        <span className="results__amount">
          <Money {...rowAmount("expense", entry.shareCents)} currency={entry.householdCurrency} />
          <span className="results__sub">your share</span>
        </span>
      </Link>
    </li>
  );
}
