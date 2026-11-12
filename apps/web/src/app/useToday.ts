import { dateKey } from "@domain/ledger.ts";
import { useSyncExternalStore } from "react";

/**
 * The person's local date (`YYYY-MM-DD`, `dateKey()`), as one store every screen reads: Home's
 * report, its rows and calendar, and Activity's rows and totals agree on the same day in a render
 * (MAZ-136: income dated after today is expected). The store wakes its readers at the next local
 * midnight, and when the tab becomes visible or the window gets focus again (a sleeping laptop or a
 * throttled background tab can miss the timer); React re-renders them only if the date changed.
 */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function notify() {
  for (const listener of listeners) listener();
}

/** Arms one timer for the next local midnight. A timer that fires early just re-arms. */
function schedule() {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  if (!listeners.size) return;
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  timer = setTimeout(() => {
    notify();
    schedule();
  }, Math.max(1, midnight.getTime() - now.getTime()));
}

function onWake() {
  if (document.visibilityState === "hidden") return;
  notify();
  schedule();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    schedule();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      schedule();
    }
  };
}

/** The local date key, refreshed at midnight and on return to the tab. */
export function useToday(): string {
  return useSyncExternalStore(subscribe, () => dateKey());
}
