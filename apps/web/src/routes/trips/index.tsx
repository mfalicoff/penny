import { createFileRoute } from "@tanstack/react-router";
import { TripsPage } from "../../features/trips/TripsPage";

/** Legacy URL kept from the Expo app (Sidebar › Together › Trips): personal and shared trips (MAZ-93). */
export const Route = createFileRoute("/trips/")({
  staticData: { title: "Trips" },
  component: TripsPage,
});
