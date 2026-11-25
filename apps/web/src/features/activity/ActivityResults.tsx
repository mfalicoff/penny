import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Ledger, Transaction } from "@domain/ledger.ts";
import { isExpectedIncome } from "@domain/summary.ts";
import { ApiError } from "../../api/client";
import { useToday } from "../../app/useToday";
import { searchTransactionsQuery } from "../../api/search";
import { useAccountEmail } from "../../auth/account";
import { Badge, Button, cx, Kbd } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { tileStyle } from "../../design/categoryTint";
import { formatCents, Money } from "../../design/Money";
import { EmptyState, LoadingState, useOnline } from "../../design/states";
import { useLedgerSync } from "../../offline/OfflineLedgerProvider";
import { useLedgerCurrency } from "../../offline/useLedgerCurrency";
import { dayLabel } from "../households/model";
import type { EntryAction } from "../entries/EntryDetail";
import { categoryIcon, repeatLabel, splitSummary } from "../entries/model";
import { rowAmount } from "../recurring/model";
import { categoryName, dayTotal, groupByDay, localRows, type ActivityRow, type RowFilters, type SharedState } from "./data";
import type { ActivitySearch } from "./filters";
import { activeDay, KIND_FILTERS, periodOf, searchRange, shortPeriodLabel } from "./filters";

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
  /** Opens a personal entry: its detail, or straight into Edit or Delete (the table's row actions, E and ⌫). */
  onOpen: (entry: Transaction, opener: HTMLElement, action: EntryAction) => void;
  /** `table` on a desktop (`web-activity`); the day-grouped list everywhere else. */
  layout: RowLayout;
  /** The row whose entry is open beside the list. */
  selectedKey: string | undefined;
  /**
   * `ipad-activity`: the pane always shows a listed entry. When the listed rows don't include the
   * selected one, this gets the first personal row's entry and its row (or `null` when the list
   * has none), so Activity can select it.
   */
  autoSelect?: ((pick: { entry: Transaction; row: HTMLElement } | null) => void) | undefined;
  /** Drops these search parameters (the empty state's "Search all time" and "Clear filters"). */
  onClear: (...keys: (keyof ActivitySearch)[]) => void;
  /** The desktop table's checkboxes (`web-activity-selected`, MAZ-276); the list has none. */
  selection?: TableSelection | undefined;
}

/**
 * The entries ticked in the desktop table for a bulk action (MAZ-276). Only personal entries can
 * be ticked: a shared expense belongs to its household and has no checkbox.
 */
export interface TableSelection {
  ids: ReadonlySet<string>;
  toggle: (entry: Transaction) => void;
  /** Ticks (or clears) all of these: the header checkbox. */
  setMany: (entries: Transaction[], on: boolean) => void;
  clear: () => void;
  /** ⌫ with entries ticked: asks to delete them all (`web-activity-bulk-delete`). */
  deleteSelected: () => void;
  /** The personal entries the table lists now, so a filter that hides a ticked entry drops it. */
  listed: (ids: string[]) => void;
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
export function ActivityResults({ search, filters, ledger, shared, onOpen, onClear, layout, selectedKey, autoSelect, selection }: ResultsProps) {
  const email = useAccountEmail();
  const range = searchRange(search);
  const serverSearch = useInfiniteQuery(
    searchTransactionsQuery(email, { ...(filters.query ? { query: filters.query } : {}), ...range, ...(filters.kind ? { kind: filters.kind } : {}) }),
  );
  const sync = useLedgerSync();
  const online = useOnline();
  const [limit, setLimit] = useState(PAGE);

  const localLedger = sync?.ledger ?? null;
  // Personal amounts are in the ledger's currency, from the offline store's copy (MAZ-242).
  const currency = useLedgerCurrency().data;
  if (sync && localLedger) {
    const stale = serverSearch.data !== undefined && serverSearch.dataUpdatedAt < sync.changedAt;
    const unreachable = serverSearch.data === undefined && serverSearch.error instanceof ApiError && serverSearch.error.status === 0;
    if (sync.pending.count > 0 || !online || sync.phase === "offline" || stale || unreachable) {
      const pending = new Set(sync.pending.entryIds);
      const sharedRows = shared.status === "ready" ? shared.rows : [];
      const rows = localRows(localLedger, sharedRows, filters, pending);
      return (
        <section aria-label="Search results" className="activity-results">
          <p role="status" aria-live="polite" className="visually-hidden">
            {rows.length === 0 ? "No matching transactions on this device." : `${plural(rows.length)} on this device`}
          </p>
          <p className="note">
            Showing what this browser has, including changes waiting to sync.{" "}
            {shared.status === "ready" ? "Shared expenses are as Penny last loaded them; smarter matching needs a connection." : "Shared expenses and smarter matching need a connection."}
          </p>
          {rows.length === 0 ? <NoResults search={search} onClear={onClear} /> : null}
          <RowList rows={rows.slice(0, limit)} grouped={!filters.query} complete={rows.length <= limit} ledger={localLedger} currency={localLedger.currency} layout={layout} selectedKey={selectedKey} onOpen={onOpen} autoSelect={autoSelect} selection={layout === "table" ? selection : undefined} />
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
    // `web-activity-searching`: the table keeps its headers, with the spinner centred in it.
    return layout === "table" ? (
      <section aria-label="Search results" className="activity-results activity-pending">
        {/* Only the headers' look: the status below says what's happening. */}
        <table className="activity-table" aria-hidden="true">
          <TableHead pick={Boolean(selection)} />
        </table>
        <LoadingState label="Searching…" />
      </section>
    ) : (
      <LoadingState label="Searching…" />
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
      {/* Read out, not shown: the cards show no count over the list (the desktop summary line counts the period). */}
      <p role="status" aria-live="polite" className="visually-hidden">
        {total === 0 && !serverSearch.hasNextPage ? "No matching transactions." : `${plural(total)}${filters.category && serverSearch.hasNextPage ? " so far" : ""}`}
      </p>
      {total === 0 && !serverSearch.hasNextPage ? <NoResults search={search} onClear={onClear} /> : null}
      {/* A search with words is ranked by relevance, not date, so only browsing is grouped by day. */}
      <RowList rows={rows} grouped={!filters.query} complete={!serverSearch.hasNextPage} ledger={localLedger ?? ledger} currency={currency} layout={layout} selectedKey={selectedKey} onOpen={onOpen} autoSelect={autoSelect} selection={layout === "table" ? selection : undefined} />
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
 * where it looked, and offers to look in every period ("Search all months") or to drop the filters.
 */
function NoResults({ search, onClear }: { search: ActivitySearch; onClear: ResultsProps["onClear"] }) {
  const today = useToday();
  const period = periodOf(search);
  const day = activeDay(search);
  const kind = KIND_FILTERS.find((option) => option.value === search.kind)?.label.toLowerCase();
  const scope = [day ? dayLabel(day, true) : period.type === "all" ? "" : shortPeriodLabel(period, today), kind ?? ""].filter(Boolean).join(" ");
  const limited = period.type !== "all" || search.day !== undefined;
  const filtered = Boolean(search.kind || search.category || search.day);
  const actions =
    limited || filtered ? (
      <div className="state__actions">
        {limited ? (
          <Button variant="primary" onClick={() => { onClear("month", "year", "day"); }}>
            {period.type === "year" ? "Search all years" : "Search all months"}
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

/**
 * The day header: Today, Yesterday, or the weekday and date (with the year when it isn't this
 * year's). The desktop table also names the date after Today ("Today · Monday, Nov 9", `web-activity`).
 */
function dayHeading(date: string, today: string, long = false): string {
  const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  const label = value.toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric", ...(date.startsWith(today.slice(0, 4)) ? {} : { year: "numeric" }), timeZone: "UTC" });
  if (date === today) return long ? `Today · ${label}` : "Today";
  const [todayYear = 2000, todayMonth = 1, todayDay = 1] = today.split("-").map(Number);
  if (Date.UTC(todayYear, todayMonth - 1, todayDay) - value.getTime() === 86_400_000) return long ? `Yesterday · ${label}` : "Yesterday";
  return label;
}

export type RowLayout = "list" | "table";

interface RowListProps {
  rows: ActivityRow[];
  /** Rows are in date order: show them in day sections with each day's total. */
  grouped: boolean;
  /** Every matching row is listed; otherwise the last day may continue on the next page and gets no total. */
  complete: boolean;
  ledger: Ledger | null;
  currency: string | undefined;
  layout: RowLayout;
  selectedKey: string | undefined;
  onOpen: ResultsProps["onOpen"];
  autoSelect: ResultsProps["autoSelect"];
  selection: TableSelection | undefined;
}

/** What a row needs to describe a personal entry. */
interface RowContext {
  categories: Map<string, Ledger["categories"][number]>;
  accounts: Map<string, string>;
  ledger: Ledger | null;
  currency: string | undefined;
  today: string;
  grouped: boolean;
  selectedKey: string | undefined;
  onOpen: ResultsProps["onOpen"];
  selection: TableSelection | undefined;
}

/**
 * Browsing lists the rows by day (`iphone-activity`, `ipad-activity`, `web-activity`): a heading
 * with the day's total, then that day's rows. On a desktop the rows are a table (Entry, Account,
 * Split, Amount) with each row's Edit and Delete, and the keyboard moves through it.
 */
function RowList({ rows, grouped, complete, ledger, currency, layout, selectedKey, onOpen, autoSelect, selection }: RowListProps) {
  const today = useToday();
  // MAZ-276: tell Activity which personal entries are listed, so a hidden one leaves the selection.
  const listedIds = rows.flatMap((row) => (row.source === "personal" ? [row.entry.id] : [])).join(" ");
  const report = selection?.listed;
  useEffect(() => {
    report?.(listedIds ? listedIds.split(" ") : []);
  }, [report, listedIds]);
  // `ipad-activity`: when the selected entry isn't listed (nothing selected yet, it was deleted or
  // the filters hide it), select the first personal row, or nothing when there is none.
  const listed = selectedKey !== undefined && rows.some((row) => row.key === selectedKey);
  const first = rows.find((row) => row.source === "personal");
  const pickKey = autoSelect && !listed ? (first?.key ?? (selectedKey === undefined ? undefined : null)) : undefined;
  useEffect(() => {
    if (!autoSelect || pickKey === undefined) return;
    if (pickKey === null || first?.source !== "personal") {
      autoSelect(null);
      return;
    }
    const row = [...document.querySelectorAll<HTMLElement>("[data-row-key]")].find((element) => element.dataset.rowKey === pickKey);
    if (row) autoSelect({ entry: first.entry, row });
  }, [autoSelect, pickKey, first]);
  if (rows.length === 0) return null;
  const context: RowContext = {
    categories: new Map(ledger?.categories.map((category) => [category.id, category])),
    accounts: new Map(ledger?.accounts.map((account) => [account.id, account.name])),
    ledger,
    currency,
    today,
    grouped,
    selectedKey,
    onOpen,
    selection,
  };
  const groups = grouped ? groupByDay(rows) : [{ date: "", rows }];
  const totalOf = (index: number) => {
    const group = groups[index];
    return group && grouped && (complete || index < groups.length - 1) ? dayTotal(group.rows, currency, today) : null;
  };
  const dayTotalText = (total: { cents: number; currency: string } | null) =>
    total ? (
      <span className="day-group__total">
        <span className="visually-hidden">Day total </span>
        <Money cents={total.cents} currency={total.currency} tone={total.cents > 0 ? "income" : "expense"} signed />
      </span>
    ) : null;

  if (layout === "table") return <RowTable groups={groups} context={context} totalOf={totalOf} dayTotalText={dayTotalText} />;

  const row = (item: ActivityRow) => <Row key={item.key} row={item} context={context} />;
  if (!grouped) return <ul className="results">{rows.map(row)}</ul>;
  return (
    <div className="day-groups">
      {groups.map((group, index) => (
        <div key={group.date} className="day-group">
          <div className="day-group__head">
            <h2 className="day-group__title">
              <time dateTime={group.date}>{dayHeading(group.date, today)}</time>
            </h2>
            {dayTotalText(totalOf(index))}
          </div>
          <ul className="results day-group__rows">{group.rows.map(row)}</ul>
        </div>
      ))}
    </div>
  );
}

/** The amount as the cards sign it (MAZ-202): expenses and shares −, income +, investments unsigned; expected income amber, unsigned. */
function RowAmount({ row, context }: { row: ActivityRow; context: RowContext }) {
  if (row.source === "shared") return <Money {...rowAmount("expense", row.entry.shareCents)} currency={row.entry.householdCurrency} />;
  const { entry } = row;
  return isExpectedIncome(entry, context.today) ? <Money cents={entry.share} currency={context.currency} tone="pending" /> : <Money {...rowAmount(entry.kind, entry.share)} currency={context.currency} tone={TONE[entry.kind]} />;
}

/** "3 ways" for a shared row, when its total divides evenly into the share. */
function sharedWays(total: number, share: number): number | null {
  if (share <= 0 || share >= total) return null;
  const ways = Math.round(total / share);
  return ways >= 2 && Math.abs(Math.round(total / ways) - share) <= 1 ? ways : null;
}

function Row({ row, context }: { row: ActivityRow; context: RowContext }) {
  const { categories, accounts, ledger, currency, today, grouped, selectedKey, onOpen } = context;
  const selected = row.key === selectedKey;
  if (row.source === "personal") {
    const { entry } = row;
    const category = categories.get(entry.categoryId);
    const account = entry.accountId ? accounts.get(entry.accountId) : undefined;
    // MAZ-136: income dated after today is expected; it counts toward Projected, not Left to spend.
    const expected = isExpectedIncome(entry, today);
    const split = splitSummary(entry);
    const repeat = entry.recurringId ? repeatLabel(entry, ledger) : null;
    // `iphone-activity`: the account (or the category), then the split and the repeat.
    const meta = [row.pending ? "Waiting to sync" : null, expected ? "Expected" : null, account ?? category?.name, split ? (split.people ? `split ${String(split.people)} ways` : "your share") : null, repeat ? repeat.toLowerCase() : null].filter(Boolean).join(" · ");
    return (
      <li className={cx("results__row activity-row", selected && "activity-row--selected")} style={tileStyle({ ...category, entryKind: entry.kind })}>
        <button
          type="button"
          className="activity-row__main"
          data-row-key={row.key}
          aria-current={selected ? "true" : undefined}
          onClick={(event) => {
            onOpen(entry, event.currentTarget, "detail");
          }}
        >
          <span className={expected ? "category-dot category-dot--expected" : "category-dot"}>
            <Icon name={categoryIcon(category?.icon)} size={18} />
          </span>
          <span className="results__title">{entry.title}</span>
          <span className="results__meta">
            {meta}
            {category && account ? <span className="visually-hidden"> · {category.name}</span> : null}
            <span className={grouped ? "visually-hidden" : undefined}>
              {" · "}
              <time dateTime={entry.date}>{dayLabel(entry.date, true)}</time>
            </span>
          </span>
          <span className="results__amount">
            <RowAmount row={row} context={context} />
            {split ? <span className="results__sub">of {formatCents(entry.total, currency)}</span> : null}
          </span>
        </button>
      </li>
    );
  }
  const { entry } = row;
  return (
    <li className="results__row activity-row" style={tileStyle(entry.category)}>
      <Link to="/households/$id/expenses/$expenseId" params={{ id: entry.householdId, expenseId: entry.id }} className="activity-row__main" data-row-key={row.key}>
        <span className="category-dot">
          <Icon name={categoryIcon(entry.category.icon)} size={18} />
        </span>
        <span className="results__title">{entry.title}</span>
        <span className="results__meta">
          {entry.householdName ? `Shared · ${entry.householdName}` : "Shared"}
          <span className="visually-hidden"> · {entry.category.name}</span>
          <span className={grouped ? "visually-hidden" : undefined}>
            {" · "}
            <time dateTime={entry.date}>{dayLabel(entry.date, true)}</time>
          </span>
        </span>
        <span className="results__amount">
          <RowAmount row={row} context={context} />
          <span className="results__sub">your share</span>
        </span>
      </Link>
    </li>
  );
}

const EDITABLE = "[data-row-key]";

/**
 * The desktop table (`web-activity`): a header row, then for each day a day row with its total and
 * that day's entries. ↑ and ↓ move between entries, ↵ opens one, E edits it and ⌫ deletes it; the
 * same Edit and Delete show on the hovered, focused or selected row.
 */
/** The desktop table's column headers (`web-activity`). */
function TableHead({ pick = false, rows = [], selection }: { pick?: boolean; rows?: Transaction[]; selection?: TableSelection | undefined }) {
  const ticked = selection ? rows.filter((entry) => selection.ids.has(entry.id)).length : 0;
  return (
      <thead>
        <tr>
          {pick ? (
            <th scope="col" className="activity-table__pick">
              {/* `web-activity` draws no header checkbox; it shows once entries are ticked (`web-activity-selected`). */}
              {selection && selection.ids.size > 0 && rows.length > 0 ? (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={ticked === rows.length ? true : ticked === 0 ? false : "mixed"}
                  aria-label="Select all listed entries"
                  className={cx("pick-box", ticked === rows.length ? "pick-box--on" : ticked > 0 && "pick-box--mixed")}
                  onClick={() => {
                    selection.setMany(rows, ticked !== rows.length);
                  }}
                >
                  <span className="pick-box__mark" aria-hidden="true" />
                </button>
              ) : (
                <span className="visually-hidden">Select</span>
              )}
            </th>
          ) : null}
          <th scope="col" className="activity-table__entry-head">Entry</th>
          <th scope="col">Account</th>
          <th scope="col">Split</th>
          <th scope="col" className="activity-table__num">
            Amount
          </th>
          <th scope="col">
            <span className="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
  );
}

function RowTable({
  groups,
  context,
  totalOf,
  dayTotalText,
}: {
  groups: { date: string; rows: ActivityRow[] }[];
  context: RowContext;
  totalOf: (index: number) => { cents: number; currency: string } | null;
  dayTotalText: (total: { cents: number; currency: string } | null) => ReactNode;
}) {
  const hintId = useId();
  const personal = new Map(groups.flatMap((group) => group.rows).flatMap((row) => (row.source === "personal" ? [[row.key, row.entry] as const] : [])));
  const { selection } = context;
  const picking = Boolean(selection && selection.ids.size > 0);

  function onKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape" && selection && picking) {
      event.preventDefault();
      selection.clear();
      return;
    }
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(EDITABLE) : null;
    if (!target) return;
    const all = [...event.currentTarget.querySelectorAll<HTMLElement>(EDITABLE)];
    const index = all.indexOf(target);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      all[Math.min(all.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && selection && picking) {
      event.preventDefault();
      selection.deleteSelected();
      return;
    }
    const entry = personal.get(target.dataset.rowKey ?? "");
    if (!entry) return;
    if ((event.key === "x" || event.key === "X") && selection) {
      event.preventDefault();
      selection.toggle(entry);
    } else if (event.key === "e" || event.key === "E") {
      event.preventDefault();
      context.onOpen(entry, target, "edit");
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      context.onOpen(entry, target, "delete");
    }
  }

  return (
    <>
      <table className={cx("activity-table", picking && "activity-table--picking")} aria-describedby={hintId} onKeyDown={onKeyDown}>
        <TableHead pick={Boolean(selection)} rows={[...personal.values()]} selection={selection} />
        {groups.map((group, index) => (
          <tbody key={group.date || "results"}>
            {group.date ? (
              <tr className="activity-table__day">
                <th scope="colgroup" colSpan={selection ? 4 : 3}>
                  <time dateTime={group.date}>{dayHeading(group.date, context.today, true)}</time>
                </th>
                <td className="activity-table__num" colSpan={2}>
                  {dayTotalText(totalOf(index))}
                </td>
              </tr>
            ) : null}
            {group.rows.map((row) => (
              <TableRow key={row.key} row={row} context={context} />
            ))}
          </tbody>
        ))}
      </table>
      <p id={hintId} className="key-hints">
        <span className="visually-hidden">Keyboard: </span>
        {picking ? (
          <>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move · <Kbd>X</Kbd> select · <Kbd>⌫</Kbd> delete selected · <Kbd>Esc</Kbd> clear selection
          </>
        ) : (
          <>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move · <Kbd>↵</Kbd> open · <Kbd>E</Kbd> edit · <Kbd>⌫</Kbd> delete
            {selection ? (
              <>
                {" · "}
                <Kbd>X</Kbd> select
              </>
            ) : null}
          </>
        )}
      </p>
    </>
  );
}

function TableRow({ row, context }: { row: ActivityRow; context: RowContext }) {
  const { categories, accounts, ledger, today, grouped, selectedKey, onOpen } = context;
  const selected = row.key === selectedKey;
  if (row.source === "shared") {
    const { entry } = row;
    const ways = sharedWays(entry.totalCents, entry.shareCents);
    return (
      <tr className="activity-table__row" style={tileStyle(entry.category)}>
        {/* A shared expense belongs to its household: no checkbox (MAZ-276, owner decision). */}
        {context.selection ? <td className="activity-table__pick" /> : null}
        <td>
          <Link to="/households/$id/expenses/$expenseId" params={{ id: entry.householdId, expenseId: entry.id }} className="activity-table__entry" data-row-key={row.key}>
            <span className="category-dot">
              <Icon name={categoryIcon(entry.category.icon)} size={18} />
            </span>
            <span className="activity-table__title">{entry.title}</span>
            {entry.householdName ? <Badge>{entry.householdName}</Badge> : <Badge>Shared</Badge>}
            {grouped ? null : <time className="activity-table__date" dateTime={entry.date}>{dayLabel(entry.date, true)}</time>}
          </Link>
        </td>
        <td className="activity-table__none">—</td>
        <td>{ways ? `${String(ways)} ways` : "Shared"}</td>
        <td className="activity-table__num">
          <RowAmount row={row} context={context} />
        </td>
        <td />
      </tr>
    );
  }
  const { entry } = row;
  const category = categories.get(entry.categoryId);
  const account = entry.accountId ? accounts.get(entry.accountId) : undefined;
  const expected = isExpectedIncome(entry, today);
  const split = splitSummary(entry);
  const repeat = entry.recurringId ? repeatLabel(entry, ledger) : null;
  const { selection } = context;
  const picked = selection?.ids.has(entry.id) ?? false;
  return (
    <tr className={cx("activity-table__row", selected && "activity-table__row--selected", picked && "activity-table__row--picked")} style={tileStyle({ ...category, entryKind: entry.kind })}>
      {selection ? (
        <td className="activity-table__pick">
          {/* X ticks the focused row, as E and ⌫ reach the row's actions, so the box stays out of the tab order. */}
          <button
            type="button"
            role="checkbox"
            aria-checked={picked}
            aria-label={`Select ${entry.title}`}
            tabIndex={-1}
            className={cx("pick-box", picked && "pick-box--on")}
            onClick={() => {
              selection.toggle(entry);
            }}
          >
            <span className="pick-box__mark" aria-hidden="true" />
          </button>
        </td>
      ) : null}
      <td>
        <button
          type="button"
          className="activity-table__entry"
          data-row-key={row.key}
          aria-current={selected ? "true" : undefined}
          aria-keyshortcuts={selection ? "E Backspace X" : "E Backspace"}
          onClick={(event) => {
            onOpen(entry, event.currentTarget, "detail");
          }}
        >
          <span className={expected ? "category-dot category-dot--expected" : "category-dot"}>
            <Icon name={categoryIcon(category?.icon)} size={18} />
          </span>
          <span className="activity-table__title">{entry.title}</span>
          <span className="visually-hidden"> · {category?.name ?? "Unknown category"}</span>
          {picked ? <span className="visually-hidden"> · selected</span> : null}
          {repeat ? <Badge icon="repeat">{repeat}</Badge> : null}
          {expected ? (
            <Badge tone="pending" icon="time">
              Expected
            </Badge>
          ) : null}
          {row.pending ? (
            <Badge tone="pending" icon="time">
              Waiting to sync
            </Badge>
          ) : null}
          {grouped ? null : <time className="activity-table__date" dateTime={entry.date}>{dayLabel(entry.date, true)}</time>}
        </button>
      </td>
      <td className={account ? undefined : "activity-table__none"}>{account ?? "—"}</td>
      <td className={split ? undefined : "activity-table__none"}>{split ? (split.people ? `${String(split.people)} people` : "Custom share") : "—"}</td>
      <td className="activity-table__num">
        <RowAmount row={row} context={context} />
      </td>
      <td className="activity-table__actions">
        <Button variant="quiet" iconOnly icon="create" aria-label={`Edit ${entry.title}`} tabIndex={-1} onClick={(event) => { onOpen(entry, event.currentTarget, "edit"); }} />
        <Button variant="quiet" iconOnly icon="trash" aria-label={`Delete ${entry.title}`} tabIndex={-1} onClick={(event) => { onOpen(entry, event.currentTarget, "delete"); }} />
      </td>
    </tr>
  );
}
