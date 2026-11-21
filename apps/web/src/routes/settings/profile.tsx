import { createFileRoute } from "@tanstack/react-router";
import { ProfileSettings } from "../../features/settings/ProfileSettings";

export const Route = createFileRoute("/settings/profile")({
  staticData: { title: "Profile", back: "/settings", backLabel: "All settings" },
  component: ProfileSettings,
});
