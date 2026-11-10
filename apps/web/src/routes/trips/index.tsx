import { createFileRoute } from "@tanstack/react-router";
import { NotYetAvailable } from "../../features/placeholder/NotYetAvailable";

/** Legacy URL kept from the Expo app. Trips arrive with MAZ-93. */
export const Route = createFileRoute("/trips/")({
  staticData: { title: "Trips" },
  component: () => <NotYetAvailable page="Trips" icon="airplane" />,
});
