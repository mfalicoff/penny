import { createFileRoute } from "@tanstack/react-router";
import { tripSearchSchema } from "../../features/trips/search";
import { TripPage } from "../../features/trips/TripPage";

/**
 * Legacy URL kept from the Expo app: a personal trip (ledger id) or a shared trip (household id),
 * with a shared trip's `?month=`, `?tab=`, `?expense=` and the legacy `?add=1` (MAZ-93).
 */
export const Route = createFileRoute("/trips/$id")({
  staticData: { title: "Trip" },
  validateSearch: tripSearchSchema,
  component: Trip,
});

function Trip() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  return <TripPage id={id} search={search} />;
}
