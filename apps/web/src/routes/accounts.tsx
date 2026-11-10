import { createFileRoute } from "@tanstack/react-router";
import { NotYetAvailable } from "../features/placeholder/NotYetAvailable";

/** Legacy URL kept from the Expo app. Payment accounts arrive with MAZ-89. */
export const Route = createFileRoute("/accounts")({
  staticData: { title: "Accounts" },
  component: () => <NotYetAvailable page="Accounts" icon="wallet" />,
});
