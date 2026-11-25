import { useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { currentMonth, monthLabel } from "../households/model";
import { LoadingState } from "../../design/states";
import type { InsightsSearch } from "./model";
import { MoneyFlowChart } from "./MoneyFlowChart";
import { MonthBar } from "./parts";
import { usePeriodSlide } from "../../design/motion";
import { useMonthReport } from "./useMonthReport";

/**
 * Money flow (`/money-flow`, card `iphone-money-flow`, MAZ-224): pushed from Home's Follow your
 * money card, with Back to Home. "From coming in to going out", the month's totals, the Sankey,
 * the focus card, the focus hint and "Show as a table". Desktop Home and Insights show the same
 * diagram in their own Follow your money card.
 */
export function MoneyFlowPage({ search }: { search: InsightsSearch }) {
  const navigateTo = useNavigate({ from: "/money-flow" });
  const month = search.month ?? currentMonth();
  // docs/design/motion.md, Month and period changes.
  const content = useRef<HTMLDivElement>(null);
  usePeriodSlide(content, month);
  const { ledger, report } = useMonthReport(month);
  return (
    <div ref={content} className="page money-flow">
      <MonthBar
        month={month}
        onChange={(next) => {
          void navigateTo({ search: next ? { month: next } : {} });
        }}
      />
      <p className="page__subtitle">From coming in to going out</p>
      {!report ? <LoadingState label="Loading your month…" /> : <MoneyFlowChart variant="page" flow={report.flow} currency={ledger?.currency} monthLabel={monthLabel(month)} categories={ledger?.categories ?? []} />}
    </div>
  );
}
