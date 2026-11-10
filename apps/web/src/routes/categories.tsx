import { createFileRoute } from "@tanstack/react-router";
import { NotYetAvailable } from "../features/placeholder/NotYetAvailable";

/** Legacy URL kept from the Expo app. Categories arrive with MAZ-89. */
export const Route = createFileRoute("/categories")({
  staticData: { title: "Categories" },
  component: () => <NotYetAvailable page="Categories" icon="pricetag" />,
});
