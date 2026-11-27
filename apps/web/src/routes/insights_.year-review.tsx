import { createFileRoute } from "@tanstack/react-router";
import { YearReviewPage } from "../features/year-review/YearReviewPage";
import { yearReviewSearchSchema } from "../features/year-review/model";

/**
 * The year in review (cards `web-year-review`, `web-year-review-share`,
 * `web-year-review-share-amounts`, MAZ-292 phase 2): `?year=YYYY`, a year that's over or, from
 * December 26, the year under way (the latest offered by default). Opened from Insights' year
 * card and the January banner. The page names itself after the year ("2026 in review") and has
 * Share your year in place of search and Add entry.
 */
export const Route = createFileRoute("/insights_/year-review")({
  staticData: { title: "Year in review", back: "/insights", backLabel: "Back to Insights", backWide: true, search: false, add: false },
  validateSearch: yearReviewSearchSchema,
  component: YearReview,
});

function YearReview() {
  const search = Route.useSearch();
  return <YearReviewPage search={search} />;
}
