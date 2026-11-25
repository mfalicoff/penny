import { useSyncExternalStore } from "react";
import { z } from "zod";

/**
 * What this browser agreed to send (MAZ-129, cards `web-monitoring-prompt` and `web-privacy`).
 * Everything is off until the person chooses: the prompt's "Share reports" turns on errors and
 * performance, and Settings › Privacy switches each kind on or off, Session Replay included.
 * Choices belong to the browser, not the account, like Appearance; signing out keeps them.
 */
const choicesSchema = z.object({
  errors: z.boolean().catch(false),
  performance: z.boolean().catch(false),
  replay: z.boolean().catch(false),
  // Whether the person answered the prompt (either way), so it never asks twice.
  decided: z.boolean().catch(false),
});

export type TelemetryChoices = z.infer<typeof choicesSchema>;

export const CONSENT_STORAGE_KEY = "penny.telemetry";
export const NO_CHOICES: TelemetryChoices = {
  errors: false,
  performance: false,
  replay: false,
  decided: false,
};

function read(): TelemetryChoices {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return NO_CHOICES;
    const parsed = choicesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : NO_CHOICES;
  } catch {
    return NO_CHOICES;
  }
}

let current: TelemetryChoices = read();
const listeners = new Set<() => void>();

export function telemetryChoices(): TelemetryChoices {
  return current;
}

/** Saves a choice (and marks the question answered). */
export function setTelemetryChoices(
  change: Partial<Omit<TelemetryChoices, "decided">>,
): void {
  current = { ...current, ...change, decided: true };
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Storage blocked: the choice applies for this visit only.
  }
  for (const listener of listeners) listener();
}

/** Re-reads storage (another tab changed it, or a test reset it). */
export function reloadTelemetryChoices(): void {
  current = read();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === CONSENT_STORAGE_KEY) reloadTelemetryChoices();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useTelemetryChoices(): TelemetryChoices {
  return useSyncExternalStore(subscribe, telemetryChoices);
}
