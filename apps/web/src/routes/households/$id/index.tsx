import { createFileRoute } from "@tanstack/react-router";
import { NotYetAvailable } from "../../../features/placeholder/NotYetAvailable";

/** Legacy URL kept from the Expo app. The household page arrives with MAZ-91. */
export const Route = createFileRoute("/households/$id/")({
  staticData: { title: "Household" },
  component: () => <NotYetAvailable page="Shared households" icon="people" />,
});
