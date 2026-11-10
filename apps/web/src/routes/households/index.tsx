import { createFileRoute } from "@tanstack/react-router";
import { NotYetAvailable } from "../../features/placeholder/NotYetAvailable";

/** Legacy URL kept from the Expo app (Sidebar › Together). Households arrive with MAZ-91. */
export const Route = createFileRoute("/households/")({
  staticData: { title: "Shared" },
  component: () => <NotYetAvailable page="Shared households" icon="people" />,
});
