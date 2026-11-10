import { createFileRoute } from "@tanstack/react-router";
import { CurrencySettings } from "../../features/settings/CurrencySettings";

export const Route = createFileRoute("/settings/currency")({
  component: CurrencySettings,
});
