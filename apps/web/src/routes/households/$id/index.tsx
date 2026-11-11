import { createFileRoute } from "@tanstack/react-router";
import { HouseholdPage } from "../../../features/households/HouseholdPage";
import { householdSearchSchema } from "../../../features/households/search";

/** Legacy URL kept from the Expo app: one household, with `?month=`, `?tab=` and the legacy `?add=1` (MAZ-91). */
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
