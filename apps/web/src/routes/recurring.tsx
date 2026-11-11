import { createFileRoute } from "@tanstack/react-router";
import { RecurringPage } from "../features/recurring/RecurringPage";

/** Legacy URL kept from the Expo app (Manage › Recurring): personal recurring schedules (MAZ-90). */
export const Route = createFileRoute("/recurring")({
  staticData: { title: "Recurring" },
  component: RecurringPage,
});
