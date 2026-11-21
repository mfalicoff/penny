import { createFileRoute } from "@tanstack/react-router";
import { AppearanceSettings } from "../../features/settings/AppearanceSettings";

export const Route = createFileRoute("/settings/appearance")({
  staticData: { title: "Appearance", back: "/settings", backLabel: "All settings" },
  component: AppearanceSettings,
});
