import { createFileRoute } from "@tanstack/react-router";
import { ServerSettings } from "../../features/settings/ServerSettings";

export const Route = createFileRoute("/settings/server")({
  component: ServerSettings,
});
