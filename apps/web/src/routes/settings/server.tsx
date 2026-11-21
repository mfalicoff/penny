import { createFileRoute } from "@tanstack/react-router";
import { ServerSettings } from "../../features/settings/ServerSettings";

export const Route = createFileRoute("/settings/server")({
  staticData: { title: "Server & sync", back: "/settings", backLabel: "All settings" },
  component: ServerSettings,
});
