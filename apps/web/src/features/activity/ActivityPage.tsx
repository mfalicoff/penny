import type { Kind, Transaction } from "@domain/ledger.ts";
import { useNavigate } from "@tanstack/react-router";
import { useId, useRef, useState, type SyntheticEvent } from "react";
import { useToday } from "../../app/useToday";
import { Button, Card, ChoiceGroup, cx } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { formatCents, Money } from "../../design/Money";
import { useOnline } from "../../design/states";
import { EntryDetailDialog } from "../entries/EntryDetail";
import { categoryIcon, frequentCategories, inlineCategories } from "../entries/model";
import { CategoryPickerDialog } from "../entries/pickers";
import { useLedgerWriter } from "../entries/writer";
import { ActivityResults } from "./ActivityResults";
import { periodTotals, rowFilters, useActivityLedger, useSharedRows, type SharedState } from "./data";
import { activeDay, KIND_FILTERS, periodLabel, periodOf, periodRange, shiftPeriod, withPeriod, without, type ActivitySearch, type Period } from "./filters";

type Navigate = (update: (previous: ActivitySearch) => ActivitySearch) => void;

/**
 * Activity (`/transactions`, MAZ-88): search, the period (all time, a month or a year) with its
 * totals, quick type, category and day filters, and the list of personal and shared entries.
 * Every filter is a search parameter, so Back and Forward step through them and a filtered view
 * can be bookmarked.
 */
export function ActivityPage({ search, from }: { search: ActivitySearch; from: "/transactions" }) {
  const navigateTo = useNavigate({ from });
  const navigate: Navigate = (update) => {
    void navigateTo({ search: (previous: ActivitySearch) => update(previous) });
  };
  const online = useOnline();
  const period = periodOf(search);
  const { ledger } = useActivityLedger();
  const writer = useLedgerWriter();
  const shared = useSharedRows(period, online);
  const filters = rowFilters(search);
  const [open, setOpen] = useState<{ entry: Transaction; opener: HTMLElement } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    const query = typeof value === "string" && value.trim() ? value.trim() : undefined;
    navigate((previous) => ({ ...previous, q: query }));
  }

  return (
    <div className="page activity">
      <form role="search" className="search-form" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="activity-search">Search transactions</label>
          <input id="activity-search" ref={searchRef} name="q" type="search" defaultValue={search.q ?? ""} key={search.q ?? ""} autoComplete="off" />
        </div>
        <button type="submit" className="button">
          Search
        </button>
      </form>

      <PeriodBar search={search} period={period} navigate={navigate} />
      {ledger ? <Totals period={period} ledger={ledger} shared={shared} /> : null}
      <Filters search={search} navigate={navigate} />

      <ActivityResults
        key={JSON.stringify(search)}
        search={search}
        filters={filters}
        ledger={ledger ?? writer.ledger}
        shared={shared}
        onOpen={(entry, opener) => {
          setOpen({ entry, opener });
        }}
      />

      {open ? (
        <EntryDetailDialog
          entry={open.entry}
          onClose={() => {
            const { opener } = open;
            setOpen(null);
            // Back to where the person was: the row, or the search field if the row is gone (deleted).
            setTimeout(() => {
              // The list may have re-rendered (a save switches it to this device's copy), so find the row again by its key.
              const row = opener.isConnected ? opener : [...document.querySelectorAll<HTMLElement>("[data-row-key]")].find((element) => element.dataset.rowKey === opener.dataset.rowKey);
              if (row) row.focus();
              else searchRef.current?.focus();
            }, 0);
          }}
        />
      ) : null}
    </div>
  );
}

function PeriodBar({ search, period, navigate }: { search: ActivitySearch; period: Period; navigate: Navigate }) {
  const unit = period.type === "year" ? "year" : "month";
  return (
    <div className="activity-bar">
      <ChoiceGroup<Period["type"]>
        legend="Period"
        hideLegend
        name="activity-period"
        value={period.type}
        onChange={(type) => {
          navigate((previous) => withPeriod(previous, type));
        }}
        options={[
          { value: "all", label: "All time" },
          { value: "month", label: "Month" },
          { value: "year", label: "Year" },
        ]}
      />
      {period.type !== "all" ? (
        <div className="month-nav">
          <Button iconOnly icon="chevron-back" variant="quiet" aria-label={`Previous ${unit}`} onClick={() => { navigate((previous) => shiftPeriod(previous, -1)); }} />
          <span className="month-nav__label" aria-live="polite">
            {periodLabel(period)}
          </span>
          <Button iconOnly icon="chevron-forward" variant="quiet" aria-label={`Next ${unit}`} onClick={() => { navigate((previous) => shiftPeriod(previous, 1)); }} />
        </div>
      ) : null}
      {search.q || search.kind || search.category || search.day ? (
        <Button
          variant="quiet"
          icon="close"
          onClick={() => {
            navigate((previous) => without(previous, "q", "kind", "category", "day"));
          }}
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

function Totals({ period, ledger, shared }: { period: Period; ledger: NonNullable<ReturnType<typeof useActivityLedger>["ledger"]>; shared: SharedState & { retry: () => void } }) {
  const today = useToday();
  const result = periodTotals(ledger, period, shared.status === "ready" ? shared.rows : [], today);
  const currency = ledger.currency;
  return (
    <Card title={periodLabel(period)} className="activity-totals">
      <dl className="totals">
        <div>
          <dt>Spent</dt>
          <dd>
            <Money cents={result.expense} currency={currency} />
          </dd>
        </div>
        <div>
          <dt>Earned</dt>
          <dd>
            <Money cents={result.income} currency={currency} tone="income" />
          </dd>
        </div>
        <div>
          <dt>Invested</dt>
          <dd>
            <Money cents={result.investment} currency={currency} tone="investment" />
          </dd>
        </div>
        <div>
          <dt>Left</dt>
          <dd>
            <Money cents={result.net} currency={currency} signed />
          </dd>
        </div>
      </dl>
      <p className="note">
        Totals cover the whole period, whatever the search or filters. Investments aren't spending, but they come out of what's left.{" "}
        {shared.status === "ready" && result.sharedCount > 0
          ? `Spent includes your share of ${String(result.sharedCount)} shared expense${result.sharedCount === 1 ? "" : "s"}${shared.cached ? ", as Penny last loaded them" : ""}.`
          : null}
        {result.expectedIncome > 0 ? ` Earned leaves out ${formatCents(result.expectedIncome, currency)} of income dated after today, listed as Expected until its date.` : null}
      </p>
      {shared.status === "unavailable" ? (
        <p className="note" role="status">
          {shared.message}{" "}
          <Button variant="quiet" onClick={shared.retry}>
            Try again
          </Button>
        </p>
      ) : null}
    </Card>
  );
}

function Filters({ search, navigate }: { search: ActivitySearch; navigate: Navigate }) {
  const { ledger } = useActivityLedger();
  const [picking, setPicking] = useState(false);
  const dayId = useId();
  const period = periodOf(search);
  const range = periodRange(period);
  const day = activeDay(search);
  const categories = ledger ? frequentCategories(ledger, search.kind) : [];
  const inline = inlineCategories(categories, search.category);
  const selectedMissing = search.category && !categories.some((category) => category.id === search.category);
  return (
    <div className="activity-filters">
      <ChoiceGroup<"all" | Kind>
        legend="Type"
        name="activity-kind"
        value={search.kind ?? "all"}
        onChange={(value) => {
          navigate((previous) => ({ ...previous, kind: value === "all" ? undefined : value }));
        }}
        options={KIND_FILTERS}
      />
      {categories.length || search.category ? (
        <fieldset className="choices category-chips">
          <legend className="choices__legend">Category</legend>
          <div className="chip-row">
            <label className={cx("chip", !search.category && "chip--on")}>
              <input type="radio" name="activity-category" checked={!search.category} onChange={() => { navigate((previous) => ({ ...previous, category: undefined })); }} />
              <span>All</span>
            </label>
            {inline.map((category) => (
              <label key={category.id} className={cx("chip", category.id === search.category && "chip--on")}>
                <input type="radio" name="activity-category" checked={category.id === search.category} onChange={() => { navigate((previous) => ({ ...previous, category: category.id })); }} />
                <span className="category-dot" style={{ color: category.color }}>
                  <Icon name={categoryIcon(category.icon)} size={16} />
                </span>
                <span>{category.name}</span>
              </label>
            ))}
            {selectedMissing ? (
              <label className="chip chip--on">
                <input type="radio" name="activity-category" checked readOnly />
                <span>Another category</span>
              </label>
            ) : null}
            <Button variant="quiet" icon="list" onClick={() => { setPicking(true); }}>
              All categories
            </Button>
          </div>
        </fieldset>
      ) : null}
      <div className="form-field activity-day">
        <label htmlFor={dayId}>Day</label>
        <div className="field-with-action">
          <input
            id={dayId}
            type="date"
            value={day ?? ""}
            min={range.from ?? "2000-01-01"}
            max={range.to ?? "2100-12-31"}
            onChange={(event) => {
              const value = event.currentTarget.value;
              navigate((previous) => ({ ...previous, day: value || undefined }));
            }}
          />
          {day ? (
            <Button variant="quiet" icon="close" onClick={() => { navigate((previous) => ({ ...previous, day: undefined })); }}>
              Any day
            </Button>
          ) : null}
        </div>
      </div>
      {picking ? (
        <CategoryPickerDialog
          title="Filter by category"
          categories={categories}
          selected={search.category}
          allLabel="All categories"
          onSelect={(id) => {
            navigate((previous) => ({ ...previous, category: id }));
          }}
          onClose={() => {
            setPicking(false);
          }}
        />
      ) : null}
    </div>
  );
}
