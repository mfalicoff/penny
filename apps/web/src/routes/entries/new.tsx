import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "../../features/home/HomePage";

/**
 * Legacy URL kept from the Expo app (also the widget's +): Add entry over Home. The shell opens
 * the dialog for this path and returns to `/` when it closes.
 */
export const Route = createFileRoute("/entries/new")({
  staticData: { title: "Home" },
  component: HomePage,
});
