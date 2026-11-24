import { createFileRoute } from "@tanstack/react-router";
import { ExportSettings } from "../../features/settings/ExportSettings";

export const Route = createFileRoute("/settings/export")({
  staticData: { title: "Export data", back: "/settings", backLabel: "All settings" },
  component: ExportSettings,
});
