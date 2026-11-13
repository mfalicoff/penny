import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { Icon } from "../../design/Icon";
import { formatCents, Money } from "../../design/Money";
import { LoadingState } from "../../design/states";
import { categoryIcon } from "../entries/model";
import { currentMonth, monthLabel, shiftMonth } from "../households/model";
import { categoryComparison, type InsightsSearch } from "./model";
import { MoneyFlowChart } from "./MoneyFlowChart";
import { MonthBar, Panel } from "./parts";
import { useMonthReport } from "./useMonthReport";

/**
 * Insights (`/insights`, MAZ-92; specimens `insights`, `money-flow`; web card `web-insights`):
 * the month's recorded totals with the change in spending from last month, the full money flow,
 * and spending by category next to last month's. Both months come from the same reporting as
 * Home, shared shares included.
 */
export function InsightsPage({ search }: { search: InsightsSearch }) {
  const navigateTo = useNavigate({ from: "/insights" });
  const month = search.month ?? currentMonth();
  const previousMonth = shiftMonth(month, -1);
  const { ledger, report } = useMonthReport(month);
  const { report: previous } = useMonthReport(previousMonth);
  const comparison = useMemo(() => (report && previous ? categoryComparison(report.spending, previous.spending) : []), [report, previous]);
  const currency = ledger?.currency;
  const label = monthLabel(month);
  const previousLabel = monthLabel(previousMonth).split(" ")[0] ?? previousMonth;

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
      ) : (
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
              <dt>vs {previousLabel}</dt>
              <dd>{previous ? spendingChange(report.recorded.expense - previous.recorded.expense, currency) : "…"}</dd>
            </div>
          </dl>
          <MoneyFlowChart flow={report.flow} currency={currency} monthLabel={label} />
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
                        {label.split(" ")[0]}
                      </th>
                      <th scope="col" className="num">
                        {previousLabel}
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
                            <span className="category-dot" style={row.color ? { color: row.color } : undefined}>
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
        </>
      )}
    </div>
  );
}

function spendingChange(delta: number, currency: string | undefined): string {
  if (delta === 0) return "Same spending";
  return `${formatCents(Math.abs(delta), currency)} ${delta < 0 ? "less" : "more"} spent`;
}

function changeLabel(delta: number, currency: string | undefined): string {
  if (delta === 0) return "No change";
  return `${delta < 0 ? "Down" : "Up"} ${formatCents(Math.abs(delta), currency)}`;
}
