// Before anything that defines a schema.
import "./app/zodConfig";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { applyPreferences } from "./app/preferences";
import { createQueryClient } from "./app/queryClient";
import { createAppRouter } from "./app/router";
import "./design/global.css";
import { startTelemetry } from "./telemetry/telemetry";

const container = document.getElementById("root");
if (!container) throw new Error("index.html is missing #root");

// Apply the saved theme before the first paint, so a pinned theme never flashes the system one.
applyPreferences();

const queryClient = createQueryClient();
const router = createAppRouter(queryClient);

createRoot(container).render(
  <StrictMode>
    <App queryClient={queryClient} router={router} />
  </StrictMode>,
);

// Opt-in per server (MAZ-129): off unless /telemetry.json names a collector.
void startTelemetry();
