import { createFileRoute } from "@tanstack/react-router";
import { NotYetAvailable } from "../../../../features/placeholder/NotYetAvailable";

/** Legacy URL kept from the Expo app: the household with this expense in the detail pane (MAZ-91). */
export const Route = createFileRoute("/households/$id/expenses/$expenseId")({
  staticData: { title: "Household" },
  component: () => <NotYetAvailable page="Shared households" icon="people" />,
});
