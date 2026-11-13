import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { setTransport } from "../api/client";
import { beginSession, endSession } from "../auth/lifecycle";
import { createDemoServer, DEMO_EMAIL } from "./demoServer";

/**
 * The temporary demo (MAZ-85): sample data that lives only in this tab's memory.
 *
 * - Isolated: while it runs every API call goes to an in-memory server, never the network, and
 *   it runs as an account (`DEMO_EMAIL`) whose cache keys can't match a real one.
 * - Temporary: nothing is stored. Leaving, signing out or reloading the tab ends it and drops
 *   every cached demo query.
 * - Only from sign-in: a signed-in account can't start it, so it never mixes with real data.
 */
let active = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function isDemo(): boolean {
  return active;
}

export async function startDemo(queryClient: QueryClient): Promise<void> {
  setTransport(createDemoServer());
  active = true;
  notify();
  await beginSession(queryClient, DEMO_EMAIL);
}

export async function leaveDemo(queryClient: QueryClient): Promise<void> {
  // Sign out of the demo account first, while requests still go to the demo server, so nothing
  // in flight reaches the real API under the demo's identity.
  await endSession(queryClient);
  stopDemo();
}

/** Restores the network transport without touching a cache (used by `leaveDemo` and test setup). */
export function stopDemo(): void {
  setTransport(null);
  if (!active) return;
  active = false;
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useIsDemo(): boolean {
  return useSyncExternalStore(subscribe, isDemo);
}
