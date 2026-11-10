import { createFileRoute } from "@tanstack/react-router";
import { AppearanceSettings } from "../../features/settings/AppearanceSettings";

export const Route = createFileRoute("/settings/appearance")({
  component: AppearanceSettings,
});
