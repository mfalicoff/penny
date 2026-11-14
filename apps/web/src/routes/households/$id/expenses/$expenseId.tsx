import { createFileRoute } from "@tanstack/react-router";
import { HouseholdPage } from "../../../../features/households/HouseholdPage";
import { householdSearchSchema } from "../../../../features/households/search";

/** The household with this expense in the detail panel (MAZ-91). */
export const Route = createFileRoute("/households/$id/expenses/$expenseId")({
  staticData: { title: "Household" },
  validateSearch: householdSearchSchema,
  component: HouseholdExpense,
});

function HouseholdExpense() {
  const { id, expenseId } = Route.useParams();
  const search = Route.useSearch();
  return <HouseholdPage householdId={id} expenseId={expenseId} search={search} />;
}
