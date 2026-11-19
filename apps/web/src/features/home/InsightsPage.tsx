import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useMediaQuery, WIDE } from "../../app/useMediaQuery";
import { Icon } from "../../design/Icon";
import { categoryTint, tileStyle } from "../../design/categoryTint";
import { formatCents, Money } from "../../design/Money";
import { LoadingState } from "../../design/states";
import { categoryIcon } from "../entries/model";
import { currentMonth, monthLabel, shiftMonth } from "../households/model";
import { categoryComparison, groupSmall, monthsEnding, percentOf, spendingChange, type CategoryChange, type InsightsSearch, type MonthReport } from "./model";
import { MoneyFlowChart } from "./MoneyFlowChart";
import { MonthBar, Panel } from "./parts";
import { useMonthReport } from "./useMonthReport";
import { useMonthTotals } from "./useMonthTotals";

const SIX = 6;

/** "October" for "2026-10". */
const monthName = (month: string) => monthLabel(month).split(" ")[0] ?? month;

/**
 * Insights (`/insights`, MAZ-92, MAZ-174; cards `iphone-insights`, `money-flow`, `web-insights`).
 * Both months come from the same reporting as Home, shared shares included.
 *
 * - Below 1100px (`iphone-insights`): spending leads, as a category donut with one
 *   month-over-month sentence, then the categories and the money flow.
 * - From 1100px (`web-insights`): Came in / Went out / Left over and the change from last month,
 *   the full-width money flow, then the category table compared with last month beside the last
 *   six months of income and spending.
 */
export function InsightsPage({ search }: { search: InsightsSearch }) {
  const navigateTo = useNavigate({ from: "/insights" });
  const month = search.month ?? currentMonth();
  const previousMonth = shiftMonth(month, -1);
  const { ledger, report } = useMonthReport(month);
  const { report: previous } = useMonthReport(previousMonth);
  const comparison = useMemo(() => (report && previous ? categoryComparison(report.spending, previous.spending) : []), [report, previous]);
  const wide = useMediaQuery(WIDE);
  const currency = ledger?.currency;
  const label = monthLabel(month);

  return (
    <div className="page insights">
      <MonthBar
        month={month}
        onChange={(next) => {
          void navigateTo({ search: next ? { month: next } : {} });
        }}
      />
      {!report ? (
        <LoadingState label="Loading your month…" />
      ) : wide ? (
        <>
          <dl className="insights__totals">
            <div>
              <dt>Came in</dt>
              <dd>
                <Money cents={report.recorded.income} currency={currency} tone="income" />
              </dd>
            </div>
            <div>
              <dt>Went out</dt>
              <dd>
                <Money cents={report.recorded.expense + report.recorded.investment} currency={currency} />
              </dd>
            </div>
            <div>
              <dt>{report.recordedNet < 0 ? "Overspent" : "Left over"}</dt>
              <dd>
                <Money cents={Math.abs(report.recordedNet)} currency={currency} />
              </dd>
            </div>
            <div>
              <dt>vs {monthName(previousMonth)}</dt>
              <dd>{previous ? changeSentence(report.recorded.expense - previous.recorded.expense, currency) : "…"}</dd>
            </div>
          </dl>
          {/* The totals are just above, so the card shows only the diagram (web-insights). */}
          <MoneyFlowChart flow={report.flow} currency={currency} monthLabel={label} compact />
          <div className="insights__low">
            <CategoryTable comparison={comparison} month={month} previousMonth={previousMonth} currency={currency} />
            <SixMonths month={month} currency={currency} />
          </div>
        </>
      ) : (
        <>
          <SpendingSummary report={report} previous={previous} comparison={comparison} previousMonth={previousMonth} currency={currency} />
          <CategoryList report={report} currency={currency} />
          <MoneyFlowChart flow={report.flow} currency={currency} monthLabel={label} />
        </>
      )}
    </div>
  );
}

function changeSentence(delta: number, currency: string | undefined): string {
  if (delta === 0) return "Same spending";
  return `${formatCents(Math.abs(delta), currency)} ${delta < 0 ? "less" : "more"} spent`;
}

function changeLabel(delta: number, currency: string | undefined): string {
  if (delta === 0) return "No change";
  return `${delta < 0 ? "Down" : "Up"} ${formatCents(Math.abs(delta), currency)}`;
}

/** "Food & drinks", "Food & drinks and Shopping". */
const listNames = (names: readonly string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}` : (names[0] ?? ""));

/**
 * Card `iphone-insights`: the month's recorded spending (your share) as a category donut with the
 * total in its centre, and one sentence comparing it with last month, with the categories behind
 * the change. The donut and the two bars are decoration; the text carries every value.
 */
function SpendingSummary({ report, previous, comparison, previousMonth, currency }: { report: MonthReport; previous: MonthReport | null; comparison: readonly CategoryChange[]; previousMonth: string; currency: string | undefined }) {
  const { rows, total } = groupSmall(report.spending);
  const spent = report.recorded.expense;
  const before = previous?.recorded.expense;
  const change = before === undefined ? null : spendingChange(spent, before, comparison);
  const name = monthName(previousMonth);
  // The donut's rings: each category's share of the circle, drawn from 12 o'clock clockwise.
  const shares = rows.map((row) => (total > 0 ? row.amount / total : 0));
  const arcs = rows.map((row, index) => ({ id: row.id, color: categoryTint(row), share: shares[index] ?? 0, start: shares.slice(0, index).reduce((sum, share) => sum + share, 0) }));
  const longest = Math.max(spent, before ?? 0, 1);
  return (
    <Panel title="Spending" className="spending" action={<span className="muted">Your share</span>}>
      <div className="spending__body">
        <div className="donut">
          <svg viewBox="0 0 120 120" className="donut__ring" aria-hidden="true" focusable="false">
            <circle cx="60" cy="60" r="48" pathLength="100" className="donut__track" />
            {arcs.map((arc) => (
              <circle key={arc.id} cx="60" cy="60" r="48" pathLength="100" stroke={arc.color} strokeDasharray={`${String(arc.share * 100)} 100`} strokeDashoffset={String(-arc.start * 100)} className="donut__arc" />
            ))}
          </svg>
          <p className="donut__label">
            <strong className="pk-num">{formatCents(spent, currency)}</strong>
            <span>Spent</span>
          </p>
        </div>
        <div className="spending__compare">
          <p className="spending__sentence">{change === null ? `Comparing with ${name}…` : change.delta === 0 ? `Same as ${name}` : `${formatCents(Math.abs(change.delta), currency)} ${change.delta < 0 ? "less" : "more"} than ${name}`}</p>
          {change && change.drivers.length ? <p className="muted spending__drivers">Mostly {listNames(change.drivers)}.</p> : null}
          {before !== undefined ? (
            <div className="spending__bars" aria-hidden="true">
              <span className="spending__bar">
                <i style={{ width: `${String((spent / longest) * 100)}%` }} />
                {monthName(report.month).slice(0, 3)}
              </span>
              <span className="spending__bar spending__bar--previous">
                <i style={{ width: `${String((before / longest) * 100)}%` }} />
                {name.slice(0, 3)}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

/** Card `iphone-insights` "Categories": recorded spending by category, largest first, with its share. */
function CategoryList({ report, currency }: { report: MonthReport; currency: string | undefined }) {
  const { rows, total } = groupSmall(report.spending);
  return (
    <Panel list title="Categories" className="insights__list">
      {rows.length ? (
        <ol className="breakdown__list">
          {rows.map((row) => (
            <li key={row.id} className="breakdown__row">
              <span className="category-dot" style={tileStyle(row)}>
                <Icon name={categoryIcon(row.icon)} size={18} />
              </span>
              <span className="breakdown__name">{row.name}</span>
              <span className="breakdown__amount">
                <Money cents={row.amount} currency={currency} />
                <span className="visually-hidden">, </span>
                <span className="breakdown__percent">{percentOf(row.amount, total)}%</span>
              </span>
              <span className="breakdown__track" aria-hidden="true">
                <span className="breakdown__fill" style={{ width: `${String((row.amount / Math.max(1, total)) * 100)}%`, background: categoryTint(row) }} />
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">No spending recorded in {monthLabel(report.month)}.</p>
      )}
    </Panel>
  );
}

function CategoryTable({ comparison, month, previousMonth, currency }: { comparison: readonly CategoryChange[]; month: string; previousMonth: string; currency: string | undefined }) {
  const label = monthLabel(month);
  return (
    <Panel title="Spending by category" className="insights__categories">
      {comparison.length ? (
        <div className="table-scroll">
          <table className="category-compare">
            <caption className="visually-hidden">
              Spending by category, {label} compared with {monthLabel(previousMonth)}, your share
            </caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col" className="num">
                  {monthName(month)}
                </th>
                <th scope="col" className="num">
                  {monthName(previousMonth)}
                </th>
                <th scope="col" className="num">
                  Change
                </th>
                <th scope="col" className="num">
                  Of spending
                </th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((row) => (
                <tr key={row.key}>
                  <th scope="row">
                    <span className="category-compare__name">
                      <span className="category-dot" style={tileStyle(row)}>
                        <Icon name={categoryIcon(row.icon)} size={16} />
                      </span>
                      {row.name}
                    </span>
                  </th>
                  <td className="num">
                    <Money cents={row.current} currency={currency} />
                  </td>
                  <td className="num muted">
                    <Money cents={row.previous} currency={currency} tone="muted" />
                  </td>
                  <td className="num">{changeLabel(row.change, currency)}</td>
                  <td className="num">{row.share}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">
          No spending in {label} or {monthLabel(previousMonth)}.
        </p>
      )}
    </Panel>
  );
}

/**
 * Card `web-insights` "Last 6 months": recorded income and spending (your share) of the six months
 * ending with the shown one. The bars are decoration; a table under them lists every value.
 */
function SixMonths({ month, currency }: { month: string; currency: string | undefined }) {
  const months = useMemo(() => monthsEnding(month, SIX), [month]);
  const totals = useMonthTotals(months);
  const highest = totals ? Math.max(1, ...totals.flatMap((item) => [item.income, item.spent])) : 1;
  return (
    <Panel
      title="Last 6 months"
      className="six-months"
      action={
        <span className="six-months__legend muted" aria-hidden="true">
          <span className="tile__dot tile__dot--income" />
          in <span className="tile__dot tile__dot--expense" />
          spent
        </span>
      }
    >
      {totals ? (
        <>
          <div className="six-months__chart" aria-hidden="true">
            {totals.map((item) => (
              <div key={item.month} className="six-months__month">
                <div className="six-months__bars">
                  <i className="six-months__bar six-months__bar--income" style={{ height: `${String((item.income / highest) * 100)}%` }} />
                  <i className="six-months__bar six-months__bar--spent" style={{ height: `${String((item.spent / highest) * 100)}%` }} />
                </div>
                {monthName(item.month).slice(0, 3)}
              </div>
            ))}
          </div>
          <details className="flow__table">
            <summary>Show as a table</summary>
            <div className="table-scroll">
              <table>
                <caption className="visually-hidden">Came in and spent, your share, the six months to {monthLabel(month)}</caption>
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col" className="num">
                      Came in
                    </th>
                    <th scope="col" className="num">
                      Spent
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {totals.map((item) => (
                    <tr key={item.month}>
                      <th scope="row">{monthLabel(item.month)}</th>
                      <td className="num">
                        <Money cents={item.income} currency={currency} tone="income" />
                      </td>
                      <td className="num">
                        <Money cents={item.spent} currency={currency} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className="muted">Loading the last six months…</p>
      )}
    </Panel>
  );
}
