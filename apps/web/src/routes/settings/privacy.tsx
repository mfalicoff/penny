import { createFileRoute } from "@tanstack/react-router";
import { PrivacySettings } from "../../features/settings/PrivacySettings";

/** Settings › Privacy (MAZ-129). Listed only when the server collects reports. */
export const Route = createFileRoute("/settings/privacy")({
  staticData: { title: "Privacy", back: "/settings", backLabel: "All settings" },
  component: PrivacySettings,
});
