import { createFileRoute } from "@tanstack/react-router";
import { InsightsPage } from "../features/home/InsightsPage";
import { insightsSearchSchema } from "../features/home/model";

/** Insights (web card `web-insights`, MAZ-92): the month's money flow and category comparison. `?month=YYYY-MM`. */
export const Route = createFileRoute("/insights")({
  staticData: { title: "Insights" },
  validateSearch: insightsSearchSchema,
  component: Insights,
});

function Insights() {
  const search = Route.useSearch();
  return <InsightsPage search={search} />;
}
