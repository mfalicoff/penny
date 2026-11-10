import { createFileRoute } from "@tanstack/react-router";
import { SettingsLayout } from "../../features/settings/SettingsLayout";

/** Settings (web card `web-settings`): a section list and a detail pane, one URL per section. */
export const Route = createFileRoute("/settings")({
  staticData: { title: "Settings" },
  component: SettingsLayout,
});
