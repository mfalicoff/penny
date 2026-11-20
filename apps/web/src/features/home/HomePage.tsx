import type { Kind, Ledger, Transaction } from "@domain/ledger.ts";
import { Link, useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { usePreferences } from "../../app/preferences";
import { useMediaQuery, WIDE } from "../../app/useMediaQuery";
import { Badge, Button, cx } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { tileStyle } from "../../design/categoryTint";
import { formatCents, HeroMoney, Money } from "../../design/Money";
import { LoadingState } from "../../design/states";
import type { SharedState } from "../activity/data";
import { AddEntryDialog } from "../entries/AddEntryDialog";
import { EntryDetailDialog } from "../entries/EntryDetail";
import { useToday } from "../../app/useToday";
import { currentMonth, dayLabel, monthLabel } from "../households/model";
import { CalendarSheet } from "./CalendarSheet";
import type { HomeSearch, MonthReport } from "./model";
import { MoneyFlowChart } from "./MoneyFlowChart";
import { CategoryBreakdown, EntryRows, MonthBar, Panel } from "./parts";
import { useMonthReport } from "./useMonthReport";

type Navigate = (update: (previous: HomeSearch) => HomeSearch) => void;
type Opened = { entry: Transaction; opener: HTMLElement } | null;

const RECENT = 5;

/**
 * Home (MAZ-92, MAZ-174, MAZ-224; cards `iphone-home`, `iphone-empty-home`, `ipad-home`,
 * `web-home`). One number leads at every width: the recorded remaining ("Left to spend") with
 * the projected remaining under it. Then, as the cards draw them:
 *
 * - below 1100px (`iphone-home`): the compact Follow your money card, which opens Money flow
 *   (`/money-flow`) and Insights, then Recent;
 * - from 1100px (`web-home`, `ipad-home`): Came in / Spent / Invested under the hero with Coming
 *   up beside it, then the Sankey beside By category.
 *
 * The calendar is a sheet over Home, opened from the calendar button in the phone's top row;
 * `?day=` opens it on that day.
 */
export function HomePage({ search }: { search: HomeSearch }) {
  const navigateTo = useNavigate({ from: "/" });
  const navigate: Navigate = (update) => {
    void navigateTo({ search: (previous: HomeSearch) => update(previous) });
  };
  const month = search.month ?? currentMonth();
  const { ledger, view, report, shared } = useMonthReport(month);
  const [open, setOpen] = useState<Opened>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const today = useToday();
  const wide = useMediaQuery(WIDE);
  const showCalendar = calendarOpen || Boolean(search.day);
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
        actions={
          <PhoneHomeActions
            onCalendar={
              ledger && report && !(isEmptyLedger(ledger) && report.empty)
                ? () => {
                    setCalendarOpen(true);
                  }
                : undefined
            }
          />
        }
      />
      {!ledger || !view || !report ? (
        <LoadingState label="Loading your month…" />
      ) : isEmptyLedger(ledger) && report.empty ? (
        <FirstEntry currency={ledger.currency} />
      ) : (
        <div className={cx("home-top", wide && "home-top--wide")}>
          <Hero report={report} currency={ledger.currency} shared={shared} wide={wide} />
          {wide ? (
            <>
              <ComingUp report={report} ledger={view} currency={ledger.currency} />
              <div className="home-sankey">
                <MoneyFlowChart
                  variant="panel"
                  flow={report.flow}
                  currency={ledger.currency}
                  monthLabel={monthLabel(month)}
                  action={
                    <Link to="/insights" search={{ month }} className="text-link">
                      Open full view
                    </Link>
                  }
                />
              </div>
              <CategoryBreakdown spending={report.spending} currency={ledger.currency} />
            </>
          ) : (
            <>
              <FlowSummary report={report} currency={ledger.currency} month={month} />
              <Panel
                list
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
            </>
          )}
        </div>
      )}
      {showCalendar && ledger && view && report ? (
        <CalendarSheet
          month={month}
          report={report}
          view={view}
          currency={ledger.currency}
          selected={search.day}
          onSelect={(day) => {
            navigate((previous) => ({ month: previous.month, day }));
          }}
          onMonth={(next) => {
            navigate(() => (next ? { month: next } : {}));
          }}
          onToday={() => {
            navigate(() => ({ day: today }));
          }}
          onOpen={onOpen}
          onClose={() => {
            setCalendarOpen(false);
            if (search.day) navigate((previous) => ({ month: previous.month }));
          }}
        />
      ) : null}
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
 * shortcut per kind that opens Add entry on it, and an empty Recent. No zero-value charts. The
 * currency is chosen in Settings › Currency (MAZ-224: the card has no link here). The cards' "Try with sample data" isn't offered: the web demo
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
        <p className="hero__amount pk-num"><HeroMoney cents={0} currency={currency} showCents={showCents} /></p>
        <p className="hero__projected">Your month fills in as you add entries.</p>
      </section>
      <Panel title="Add your first entry" className="first-entry">
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
      <Panel list title="Recent" className="home-recent">
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

/** "Nov 15". */
function shortDay(date: string) {
  const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Left to spend with Projected under it, in the cards' short line (MAZ-224): "$X projected with
 * expected pay" on phones (`iphone-home`), and on wide screens "$X projected · includes $Y
 * expected pay on Nov 15" (`web-home`, `ipad-home`, the date when one income is expected) with
 * Came in / Spent / Invested under it.
 */
function Hero({ report, currency, shared, wide }: { report: MonthReport; currency: string; shared: SharedState & { retry: () => void }; wide: boolean }) {
  const id = useId();
  const { showCents } = usePreferences();
  const overspent = report.recordedNet < 0;
  const expected = report.comingUp.filter((entry) => entry.kind === "income");
  const projected = (
    <strong>
      <span className="visually-hidden">Projected remaining: </span>
      {formatCents(report.projectedNet, currency)}
    </strong>
  );
  return (
    <section className="hero" aria-labelledby={id}>
      <h2 id={id} className="hero__label">
        Left to spend
      </h2>
      <p className="hero__amount pk-num">
        <span className="visually-hidden">Recorded remaining: </span>
        <HeroMoney cents={report.recordedNet} currency={currency} showCents={showCents} />
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
          {projected} projected
          {report.expectedIncome <= 0 ? null : wide ? (
            <>
              {" "}
              · includes <span className="pk-num">{formatCents(report.expectedIncome, currency)}</span> expected pay
              {expected.length === 1 && expected[0] ? ` on ${shortDay(expected[0].date)}` : ""}
            </>
          ) : (
            " with expected pay"
          )}
        </span>
      </p>
      {wide ? (
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
                <span className="category-dot" style={tileStyle({ ...category, entryKind: entry.kind })}>
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

/**
 * Card `iphone-home` "Follow your money": the compact phone flow summary (spent, invested, left).
 * Its title opens the Money flow screen (MAZ-224) and its Insights button opens Insights.
 */
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
      title={
        <Link to="/money-flow" search={{ month }} className="home-flow__open">
          Follow your money
          <Icon name="chevron-forward" size={16} />
        </Link>
      }
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

/**
 * Home's glass buttons on phones (cards `iphone-home`, `iphone-empty-home`): the calendar, which
 * opens the calendar sheet over Home, and Settings, where Recurring, Accounts and Categories live too.
 */
function PhoneHomeActions({ onCalendar }: { onCalendar: (() => void) | undefined }) {
  return (
    <>
      {onCalendar ? (
        <button type="button" className="glass glass-button" aria-label="Calendar" aria-haspopup="dialog" onClick={onCalendar}>
          <Icon name="calendar" size={20} />
        </button>
      ) : null}
      <Link to="/settings" className="glass glass-button" aria-label="Settings">
        <Icon name="settings" size={20} />
      </Link>
    </>
  );
}
