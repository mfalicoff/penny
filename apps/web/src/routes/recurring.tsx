import { createFileRoute } from "@tanstack/react-router";
import { RecurringPage } from "../features/recurring/RecurringPage";

/** Manage › Recurring: personal recurring schedules (MAZ-90). */
export const Route = createFileRoute("/recurring")({
  staticData: { title: "Recurring" },
  component: RecurringPage,
});
