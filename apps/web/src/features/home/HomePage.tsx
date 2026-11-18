import type { Kind, Ledger, Transaction } from "@domain/ledger.ts";
import { Link, useNavigate } from "@tanstack/react-router";
import { useId, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { usePreferences } from "../../app/preferences";
import { useMediaQuery, WIDE } from "../../app/useMediaQuery";
import { Badge, Button, ChoiceGroup, cx } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { formatCents, Money } from "../../design/Money";
import { LoadingState } from "../../design/states";
import { KIND_FILTERS } from "../activity/filters";
import type { SharedState } from "../activity/data";
import { AddEntryDialog } from "../entries/AddEntryDialog";
import { EntryDetailDialog } from "../entries/EntryDetail";
import { currentMonth, dayLabel, monthLabel } from "../households/model";
import { monthEntries, type HomeSearch, type MonthReport } from "./model";
import { MoneyFlowChart } from "./MoneyFlowChart";
import { MonthCalendar } from "./MonthCalendar";
import { CategoryBreakdown, EntryRows, MonthBar, Panel } from "./parts";
import { useMonthReport } from "./useMonthReport";

type Navigate = (update: (previous: HomeSearch) => HomeSearch) => void;
type Opened = { entry: Transaction; opener: HTMLElement } | null;

const RECENT = 5;
const PAGE = 50;

/**
 * Home (MAZ-92, MAZ-174; cards `iphone-home`, `iphone-empty-home`, `ipad-home`, `web-home`). One
 * number leads at every width: the recorded remaining ("Left to spend") with the projected
 * remaining under it, the expected income named (scheduled income and income dated after today,
 * MAZ-136). Then Follow your money, then Recent:
 *
 * - below 1100px (`iphone-home`): the compact flow card (spent, invested, left) that opens
 *   Insights, Recent, and Coming up after them;
 * - from 1100px (`web-home`): Came in / Spent / Invested under the hero with Coming up beside it,
 *   then the Sankey beside By category, both above the fold at 1440×900, then Recent.
 *
 * "Explore your month" holds the calendar and the month's entries (and, below 1100px, categories
 * and the full money flow), whose filters (`day`, `q`, `kind`, `category`) live in the URL and
 * never change a total.
 */
export function HomePage({ search }: { search: HomeSearch }) {
  const navigateTo = useNavigate({ from: "/" });
  const navigate: Navigate = (update) => {
    void navigateTo({ search: (previous: HomeSearch) => update(previous) });
  };
  const month = search.month ?? currentMonth();
  const { ledger, view, report, shared } = useMonthReport(month);
  const [open, setOpen] = useState<Opened>(null);
  const wide = useMediaQuery(WIDE);
  const selectCategory = (category: string | undefined) => {
    navigate((previous) => ({ ...previous, category }));
  };
  const onOpen = (entry: Transaction, opener: HTMLElement) => {
    setOpen({ entry, opener });
  };

  return (
    <div className="page home">
      <div className="glow" aria-hidden="true" />
      <MonthBar
        month={month}
        onChange={(next) => {
          navigate(() => (next ? { month: next } : {}));
        }}
      />
      {!ledger || !view || !report ? (
        <LoadingState label="Loading your month…" />
      ) : isEmptyLedger(ledger) && report.empty ? (
        <FirstEntry currency={ledger.currency} />
      ) : (
        <>
          <div className={cx("home-top", wide && "home-top--wide")}>
            <Hero report={report} currency={ledger.currency} shared={shared} tiles={wide} />
            {wide ? (
              <>
                <ComingUp report={report} ledger={view} currency={ledger.currency} />
                <div className="home-sankey">
                  <MoneyFlowChart
                    flow={report.flow}
                    currency={ledger.currency}
                    monthLabel={monthLabel(month)}
                    compact
                    action={
                      <Link to="/insights" search={{ month }} className="text-link">
                        Open full view
                      </Link>
                    }
                  />
                </div>
                <CategoryBreakdown level={2} spending={report.spending} currency={ledger.currency} selected={search.category} onSelect={selectCategory} />
              </>
            ) : (
              <FlowSummary report={report} currency={ledger.currency} month={month} />
            )}
            <Panel
              title="Recent"
              className="home-recent"
              action={
                <Link to="/transactions" search={{ month }} className="text-link">
                  See all
                </Link>
              }
            >
              {report.recordedEntries.length ? (
                <EntryRows entries={report.recordedEntries.slice(0, RECENT)} ledger={view} currency={ledger.currency} onOpen={onOpen} />
              ) : (
                <p className="muted">Nothing recorded in {monthLabel(month)} yet.</p>
              )}
            </Panel>
            {wide ? null : <ComingUp report={report} ledger={view} currency={ledger.currency} />}
          </div>
          <Explore wide={wide} month={month} search={search} navigate={navigate} report={report} view={view} currency={ledger.currency} onOpen={onOpen} />
        </>
      )}
      {open ? (
        <EntryDetailDialog
          entry={open.entry}
          onClose={() => {
            const { opener } = open;
            setOpen(null);
            setTimeout(() => {
              if (opener.isConnected) opener.focus();
            }, 0);
          }}
        />
      ) : null}
    </div>
  );
}

const isEmptyLedger = (ledger: Ledger) => ledger.transactions.length === 0 && ledger.recurring.length === 0;

const FIRST_KINDS = [
  { kind: "income", label: "Income", hint: "Pay, refunds", icon: "arrow-down" },
  { kind: "expense", label: "Expense", hint: "Spending", icon: "arrow-up" },
  { kind: "investment", label: "Invest", hint: "Contributions", icon: "trending-up" },
] as const;

/**
 * The empty Home (card `iphone-empty-home`, MAZ-174): Left to spend at $0, then how to start, one
 * shortcut per kind that opens Add entry on it, and an empty Recent. No zero-value charts, and the
 * currency can still be chosen. The cards' "Try with sample data" isn't offered: the web demo
 * only starts from sign-in, so it never mixes with an account (`demo/demo.ts`).
 */
function FirstEntry({ currency }: { currency: string }) {
  const heroId = useId();
  const { showCents } = usePreferences();
  const [adding, setAdding] = useState<Kind | null>(null);
  return (
    <div className="home-top">
      <section className="hero" aria-labelledby={heroId}>
        <h2 id={heroId} className="hero__label">
          Left to spend
        </h2>
        <p className="hero__amount pk-num">{showCents ? formatCents(0, currency) : formatWholeUnits(0, currency)}</p>
        <p className="hero__projected">Your month fills in as you add entries.</p>
      </section>
      <Panel
        title="Add your first entry"
        className="first-entry"
        action={
          <Link to="/settings/currency" className="text-link">
            Currency: {currency}
          </Link>
        }
      >
        <p className="muted">Start with what came in this month, then what went out.</p>
        <ul className="first-entry__kinds">
          {FIRST_KINDS.map((item) => (
            <li key={item.kind}>
              <button
                type="button"
                className={`first-entry__kind first-entry__kind--${item.kind}`}
                onClick={() => {
                  setAdding(item.kind);
                }}
              >
                <span className="first-entry__icon" aria-hidden="true">
                  <Icon name={item.icon} size={18} />
                </span>
                <span className="first-entry__label">{item.label}</span>
                <span className="first-entry__hint">{item.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Recent" className="home-recent">
        <p className="muted">Nothing yet. New entries show up here.</p>
      </Panel>
      {adding ? (
        <AddEntryDialog
          kind={adding}
          onClose={() => {
            setAdding(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** Left to spend in whole units ($1,117 for $1,116.65), when Show cents is off (MAZ-140). Display only. */
function formatWholeUnits(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cents / 100);
}

/** Left to spend with Projected under it; `tiles` adds Came in / Spent / Invested (the desktop card `web-home`). */
function Hero({ report, currency, shared, tiles }: { report: MonthReport; currency: string; shared: SharedState & { retry: () => void }; tiles: boolean }) {
  const id = useId();
  const { showCents } = usePreferences();
  const overspent = report.recordedNet < 0;
  const scheduledOut = report.projected.expense - report.recorded.expense + (report.projected.investment - report.recorded.investment);
  return (
    <section className="hero" aria-labelledby={id}>
      <h2 id={id} className="hero__label">
        Left to spend
      </h2>
      <p className="hero__amount pk-num">
        <span className="visually-hidden">Recorded remaining: </span>
        {showCents ? formatCents(report.recordedNet, currency) : formatWholeUnits(report.recordedNet, currency)}
      </p>
      {overspent ? (
        <p className="hero__over">
          <Badge tone="danger" icon="alert-circle">
            Overspent
          </Badge>{" "}
          You've spent and invested {formatCents(-report.recordedNet, currency)} more than came in this month.
        </p>
      ) : null}
      <p className="hero__projected">
        <span className="hero__dot" aria-hidden="true" />
        <span>
          <strong>
            <span className="visually-hidden">Projected remaining: </span>
            {formatCents(report.projectedNet, currency)}
          </strong>{" "}
          projected remaining ·{" "}
          {report.expectedIncome > 0 ? (
            <>
              includes <span className="pk-num pk-money--pending">{formatCents(report.expectedIncome, currency)}</span> expected income
            </>
          ) : (
            "no income expected"
          )}
          {scheduledOut > 0 ? (
            <>
              {" "}
              and <Money cents={scheduledOut} currency={currency} /> scheduled to go out
            </>
          ) : null}
        </span>
      </p>
      {tiles ? (
        <dl className="hero__tiles">
          <div className="tile">
            <dt>
              <span className="tile__dot tile__dot--income" aria-hidden="true" />
              Came in
            </dt>
            <dd>
              <Money cents={report.recorded.income} currency={currency} tone="income" />
            </dd>
          </div>
          <div className="tile">
            <dt>
              <span className="tile__dot tile__dot--expense" aria-hidden="true" />
              Spent · your share
            </dt>
            <dd>
              <Money cents={report.recorded.expense} currency={currency} />
            </dd>
          </div>
          <div className="tile">
            <dt>
              <span className="tile__dot tile__dot--investment" aria-hidden="true" />
              Invested
            </dt>
            <dd>
              <Money cents={report.recorded.investment} currency={currency} tone="investment" />
            </dd>
          </div>
        </dl>
      ) : null}
      <p className="note">
        Recorded so far; income and spending aren't an account balance, and investments are contributions.
        {report.sharedCount > 0 ? ` Spent includes your share of ${String(report.sharedCount)} shared expense${report.sharedCount === 1 ? "" : "s"}${shared.status === "ready" && shared.cached ? ", as Penny last loaded them" : ""}.` : ""}
      </p>
      {shared.status === "unavailable" ? (
        <p className="note" role="status">
          {shared.message}{" "}
          <Button variant="quiet" onClick={shared.retry}>
            Try again
          </Button>
        </p>
      ) : null}
    </section>
  );
}

function ComingUp({ report, ledger, currency }: { report: MonthReport; ledger: Ledger; currency: string }) {
  const categories = new Map(ledger.categories.map((category) => [category.id, category]));
  const shown = report.comingUp.slice(0, 5);
  return (
    <Panel
      title="Coming up"
      className="home-coming"
      action={
        <Link to="/recurring" className="text-link">
          Recurring
        </Link>
      }
    >
      {shown.length ? (
        <ul className="coming">
          {shown.map((entry) => {
            const category = categories.get(entry.categoryId);
            return (
              <li key={entry.id} className="coming__row">
                <span className="category-dot" style={{ color: category?.color }}>
                  <Icon name={entry.kind === "income" ? "arrow-down" : entry.kind === "investment" ? "trending-up" : "repeat"} size={18} />
                </span>
                <span className="coming__title">{entry.title}</span>
                <span className="coming__meta">
                  <time dateTime={entry.date}>{dayLabel(entry.date)}</time> · {entry.kind === "income" ? "expected" : "scheduled"}
                  {"householdId" in entry ? " · shared" : ""}
                </span>
                <span className="coming__amount">
                  <Money cents={entry.share} currency={currency} tone={entry.kind === "income" ? "income" : entry.kind === "investment" ? "investment" : "expense"} signed={entry.kind === "income"} />
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">Nothing else is expected or scheduled this month.</p>
      )}
      {report.comingUp.length > shown.length ? <p className="note">{`and ${String(report.comingUp.length - shown.length)} more coming up`}</p> : null}
    </Panel>
  );
}

/** Specimen `home` "Follow your money": the compact phone flow summary (spent, invested, left) that opens Insights. */
function FlowSummary({ report, currency, month }: { report: MonthReport; currency: string; month: string }) {
  const { recorded } = report;
  const left = Math.max(0, report.recordedNet);
  const beyond = Math.max(0, -report.recordedNet);
  const whole = Math.max(recorded.income, recorded.expense + recorded.investment) || 1;
  const parts = [
    { key: "expense", label: "Spent", amount: recorded.expense },
    { key: "investment", label: "Invested", amount: recorded.investment },
    { key: "left", label: "Left", amount: left },
  ];
  return (
    <Panel
      title="Follow your money"
      className="home-flow"
      action={
        <Link to="/insights" search={{ month }} className="text-link">
          <Icon name="pie-chart" size={16} /> Insights
        </Link>
      }
    >
      <div className="summary-bar" aria-hidden="true">
        {parts.map((part) => (part.amount ? <span key={part.key} className={`summary-bar__part summary-bar__part--${part.key}`} style={{ width: `${String((part.amount / whole) * 100)}%` }} /> : null))}
      </div>
      <dl className="summary-legend">
        {parts.map((part) => (
          <div key={part.key}>
            <dt>
              <span className={`tile__dot tile__dot--${part.key === "left" ? "income" : part.key}`} aria-hidden="true" />
              {part.label}
            </dt>
            <dd>{formatCents(part.amount, currency)}</dd>
          </div>
        ))}
        {beyond ? (
          <div>
            <dt>
              <span className="tile__dot tile__dot--danger" aria-hidden="true" />
              Beyond income
            </dt>
            <dd>{formatCents(beyond, currency)}</dd>
          </div>
        ) : null}
      </dl>
    </Panel>
  );
}

function Explore({
  wide,
  month,
  search,
  navigate,
  report,
  view,
  currency,
  onOpen,
}: {
  wide: boolean;
  month: string;
  search: HomeSearch;
  navigate: Navigate;
  report: MonthReport;
  view: Ledger;
  currency: string;
  onOpen: (entry: Transaction, opener: HTMLElement) => void;
}) {
  const id = useId();
  const label = monthLabel(month);
  return (
    <section className={cx("explore", wide && "explore--wide")} aria-labelledby={id}>
      <h2 id={id} className="section-title">
        Explore your month
      </h2>
      <div className="explore__grid">
        <MonthCalendar
          month={month}
          monthLabel={label}
          entries={report.calendarEntries}
          selected={search.day}
          currency={currency}
          onSelect={(day) => {
            navigate((previous) => ({ ...previous, day }));
          }}
        />
        {wide ? null : (
          <>
            <CategoryBreakdown
              spending={report.spending}
              currency={currency}
              selected={search.category}
              onSelect={(category) => {
                navigate((previous) => ({ ...previous, category }));
              }}
            />
            <div className="explore__wide">
              <MoneyFlowChart flow={report.flow} currency={currency} monthLabel={label} level={3} />
            </div>
          </>
        )}
        <div className="explore__wide explore__list">
          <MonthList key={`${month}|${search.day ?? ""}|${search.q ?? ""}|${search.kind ?? ""}|${search.category ?? ""}`} month={month} search={search} navigate={navigate} view={view} currency={currency} onOpen={onOpen} />
        </div>
      </div>
    </section>
  );
}

function MonthList({ month, search, navigate, view, currency, onOpen }: { month: string; search: HomeSearch; navigate: Navigate; view: Ledger; currency: string; onOpen: (entry: Transaction, opener: HTMLElement) => void }) {
  const searchId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [limit, setLimit] = useState(PAGE);
  const day = search.day?.startsWith(`${month}-`) ? search.day : undefined;
  const entries = useMemo(() => monthEntries(view, month, { day, q: search.q, kind: search.kind, category: search.category }), [view, month, day, search.q, search.kind, search.category]);
  const category = search.category ? view.categories.find((item) => item.id === search.category) : undefined;
  const title = day ? dayLabel(day, true) : monthLabel(month);
  const filtered = Boolean(day ?? search.q ?? search.kind ?? search.category);
  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const value = inputRef.current?.value.trim();
    navigate((previous) => ({ ...previous, q: value || undefined }));
  }
  return (
    <Panel title={`Entries · ${title}`} level={3} className="month-list">
      <form role="search" className="search-form" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor={searchId}>Search this month</label>
          <input id={searchId} ref={inputRef} name="q" type="search" defaultValue={search.q ?? ""} autoComplete="off" />
        </div>
        <button type="submit" className="button">
          Search
        </button>
      </form>
      <div className="month-list__filters">
        <ChoiceGroup<"all" | Kind>
          legend="Type"
          hideLegend
          name="home-kind"
          value={search.kind ?? "all"}
          onChange={(value) => {
            navigate((previous) => ({ ...previous, kind: value === "all" ? undefined : value }));
          }}
          options={KIND_FILTERS}
        />
        {category ? <Badge icon="pricetag">{category.name}</Badge> : null}
        {filtered ? (
          <Button
            variant="quiet"
            icon="close"
            onClick={() => {
              navigate((previous) => ({ month: previous.month }));
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>
      <p className="muted" role="status">
        {entries.length === 1 ? "1 entry" : `${String(entries.length)} entries`}
        {filtered ? " match. The month's totals above don't change with these filters." : ""}
      </p>
      {entries.length ? (
        <>
          <EntryRows entries={entries.slice(0, limit)} ledger={view} currency={currency} onOpen={onOpen} />
          {entries.length > limit ? (
            <Button
              variant="secondary"
              onClick={() => {
                setLimit((value) => value + PAGE);
              }}
            >
              Show {Math.min(PAGE, entries.length - limit)} more
            </Button>
          ) : null}
        </>
      ) : (
        <p className="muted">{search.q ? `Nothing this month matches “${search.q}”.` : "Nothing here."}</p>
      )}
    </Panel>
  );
}
