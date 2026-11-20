import { createFileRoute } from "@tanstack/react-router";
import { MoneyFlowPage } from "../features/home/MoneyFlowPage";
import { insightsSearchSchema } from "../features/home/model";

/** Money flow (card `iphone-money-flow`, MAZ-224): pushed from Home's Follow your money. `?month=YYYY-MM`. */
export const Route = createFileRoute("/money-flow")({
  staticData: { title: "Money flow", back: "/" },
  validateSearch: insightsSearchSchema,
  component: MoneyFlow,
});

function MoneyFlow() {
  const search = Route.useSearch();
  return <MoneyFlowPage search={search} />;
}
