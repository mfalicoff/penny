import { createFileRoute } from "@tanstack/react-router";
import { HouseholdPage } from "../../../features/households/HouseholdPage";
import { householdSearchSchema } from "../../../features/households/search";

/** One household, with `?month=` and `?tab=` (MAZ-91). */
export const Route = createFileRoute("/households/$id/")({
  staticData: { title: "Household" },
  validateSearch: householdSearchSchema,
  component: Household,
});

function Household() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  return <HouseholdPage householdId={id} search={search} />;
}
