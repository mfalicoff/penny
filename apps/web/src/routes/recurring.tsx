import { createFileRoute } from "@tanstack/react-router";
import { NotYetAvailable } from "../features/placeholder/NotYetAvailable";

/** Legacy URL kept from the Expo app. Recurring schedules arrive with MAZ-90. */
export const Route = createFileRoute("/recurring")({
  staticData: { title: "Recurring" },
  component: () => <NotYetAvailable page="Recurring" icon="repeat" />,
});
