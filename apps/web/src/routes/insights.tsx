import { createFileRoute } from "@tanstack/react-router";
import { NotYetAvailable } from "../features/placeholder/NotYetAvailable";

/** Insights (web card `web-insights`): the full money flow and category comparison arrive with MAZ-92. */
export const Route = createFileRoute("/insights")({
  staticData: { title: "Insights" },
  component: () => <NotYetAvailable page="Insights" icon="pie-chart" />,
});
