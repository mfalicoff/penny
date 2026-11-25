import { useEffect } from "react";
import { useServerTelemetry } from "../api/info";
import { useIsDemo } from "../demo/demo";
import { useTelemetryChoices } from "./consent";
import { applyTelemetry, OFF } from "./telemetry";

/**
 * Keeps browser telemetry in line with the server's offer, the person's choices and the demo
 * (MAZ-129). Mounted inside the signed-in shell, so signing out unmounts it and pauses reports.
 */
export function ClientTelemetry() {
  const server = useServerTelemetry();
  const choices = useTelemetryChoices();
  const demo = useIsDemo();
  useEffect(() => {
    void applyTelemetry({
      active: !demo,
      serverWeb: server.web,
      serverReplay: server.sessionReplay,
      choices,
    });
  }, [demo, server.web, server.sessionReplay, choices]);
  useEffect(
    () => () => {
      void applyTelemetry(OFF);
    },
    [],
  );
  return null;
}
