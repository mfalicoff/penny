import { useSyncExternalStore } from "react";
import { z } from "zod";

/**
 * Appearance preferences for this browser (MAZ-85). They are device settings, not account
 * data: nothing here is private or synced, and signing out keeps them.
 *
 * - `theme`: Light, Dark or System (default). Light and dark only, per MAZ-132. A saved legacy
 *   `amoled` or `catppuccin` theme migrates to dark.
 * - `reduceTransparency`: solid surfaces instead of glass. The system setting
 *   (`prefers-reduced-transparency`) applies too, in CSS, whatever this says.
 */
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

const themeSchema = z.preprocess(
  (value) => (value === "amoled" || value === "catppuccin" ? "dark" : value),
  z.enum(THEMES).catch("system"),
);

const preferencesSchema = z.object({
  theme: themeSchema,
  reduceTransparency: z.boolean().catch(false),
});

export type Preferences = z.infer<typeof preferencesSchema>;

export const STORAGE_KEY = "penny.preferences";
const DEFAULTS: Preferences = { theme: "system", reduceTransparency: false };

function read(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = preferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULTS;
  } catch {
    // Storage blocked or corrupt: fall back to the defaults rather than failing the app.
    return DEFAULTS;
  }
}

let current: Preferences = read();
const listeners = new Set<() => void>();

/** Reflects preferences on `<html>`, where the tokens and glass rules read them. */
export function applyPreferences(preferences: Preferences = current) {
  const root = document.documentElement;
  if (preferences.theme === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = preferences.theme;
  if (preferences.reduceTransparency) root.dataset.transparency = "reduced";
  else root.removeAttribute("data-transparency");
}

export function setPreferences(change: Partial<Preferences>) {
  current = { ...current, ...change };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Private mode or a full quota: the choice still applies for this visit.
  }
  applyPreferences(current);
  for (const listener of listeners) listener();
}

/** Re-reads storage (another tab changed it, or a test reset it). */
export function reloadPreferences() {
  current = read();
  applyPreferences(current);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) reloadPreferences();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, () => current);
}
