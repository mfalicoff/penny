import { createFileRoute } from "@tanstack/react-router";
import { ActivityPage } from "../features/activity/ActivityPage";
import { activitySearchSchema, type ActivitySearch } from "../features/activity/filters";

/**
 * Activity at `/transactions` (legacy route kept from the Expo app). Its typed, validated search
 * parameters (`q`, `month`, `year`, `day`, `kind`, `category`) are described in
 * `features/activity/filters.ts`. Invalid values fall back instead of failing the page, so old or
 * hand-edited links still open.
 */
export const transactionsSearchSchema = activitySearchSchema;
export type TransactionsSearch = ActivitySearch;

export const Route = createFileRoute("/transactions")({
  staticData: { title: "Activity", search: false },
  validateSearch: transactionsSearchSchema,
  component: Transactions,
});

function Transactions() {
  const search = Route.useSearch();
  return <ActivityPage search={search} from={Route.fullPath} />;
}
