import { createFileRoute } from "@tanstack/react-router";
import { SharedListPage } from "../../features/households/SharedListPage";

/** Sidebar › Together › Shared: households and shared trips (MAZ-91). */
export const Route = createFileRoute("/households/")({
  staticData: { title: "Shared" },
  component: SharedListPage,
});
