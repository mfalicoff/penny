import { createFileRoute } from "@tanstack/react-router";
import { TripsPage } from "../../features/trips/TripsPage";

/** Sidebar › Together › Trips: personal and shared trips (MAZ-93). */
export const Route = createFileRoute("/trips/")({
  staticData: { title: "Trips" },
  component: TripsPage,
});
