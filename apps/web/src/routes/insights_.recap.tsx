import { createFileRoute } from "@tanstack/react-router";
import { RecapPage } from "../features/recap/RecapPage";
import { recapSearchSchema } from "../features/recap/model";

/**
 * The monthly recap (cards `web-recap`, `web-recap-empty`, MAZ-292): `?month=YYYY-MM`, a past
 * month (last month by default). Opened from the recap banner and from Insights' Recap button.
 * The page names itself after the month ("October recap").
 */
export const Route = createFileRoute("/insights_/recap")({
  staticData: { title: "Recap", back: "/insights", backLabel: "Back to Insights", backWide: true },
  validateSearch: recapSearchSchema,
  component: Recap,
});

function Recap() {
  const search = Route.useSearch();
  return <RecapPage search={search} />;
}
