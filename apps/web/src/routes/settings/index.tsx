import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useSettingsLayout } from "../../features/settings/SettingsLayout";

/** On phones `/settings` is the section list itself; wider, Settings opens on Appearance (card `web-settings`). */
export const Route = createFileRoute("/settings/")({
  component: SettingsIndex,
});

function SettingsIndex() {
  return useSettingsLayout() === "phone" ? null : <Navigate to="/settings/appearance" replace />;
}
