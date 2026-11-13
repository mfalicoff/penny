import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "../../features/home/HomePage";

/**
 * Add entry over Home (Home's "Add your first entry" links here). The shell opens
 * the dialog for this path and returns to `/` when it closes.
 */
export const Route = createFileRoute("/entries/new")({
  staticData: { title: "Home" },
  component: () => <HomePage search={{}} />,
});
