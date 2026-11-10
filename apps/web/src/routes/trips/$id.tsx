import { createFileRoute } from "@tanstack/react-router";
import { NotYetAvailable } from "../../features/placeholder/NotYetAvailable";

/** Legacy URL kept from the Expo app. The trip page arrives with MAZ-93. */
export const Route = createFileRoute("/trips/$id")({
  staticData: { title: "Trip" },
  component: () => <NotYetAvailable page="Trips" icon="airplane" />,
});
