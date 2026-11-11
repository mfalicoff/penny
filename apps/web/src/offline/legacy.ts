import type { Ledger } from "@domain/ledger.ts";
import { parseLedger } from "./wire";

/**
 * The legacy Expo web app's offline copy. On the web, AsyncStorage is `localStorage` with the key
 * as given and no server namespace (`src/data/offlineLedger.ts`, `serverStorageKey`):
 *
 * - `penny:ledger:<lowercased email>`: `{"base": Ledger v4, "local": Ledger v4}` as JSON. The
 *   difference is the person's unsynced edits. It has no revision.
 * - `penny:active-account`: the last signed-in email. Not needed (the cookie session says who is
 *   signed in) and left alone.
 *
 * Both apps are served from the same origin, so the v2 app can read this copy. It imports it into
 * IndexedDB, keeps the original until the server has acknowledged everything that was pending,
 * and only then removes it (see `LedgerSyncEngine`).
 */
export type LegacyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const legacyLedgerKey = (email: string) => `penny:ledger:${email.trim().toLowerCase()}`;
export const legacyAsideKey = (email: string, at: string) => `${legacyLedgerKey(email)}.unreadable-${at}`;

export type LegacyCopy =
  | { kind: "none" }
  /** localStorage itself refused (blocked by a setting). Nothing can be lost by not reading it. */
  | { kind: "unavailable" }
  | { kind: "unreadable"; fingerprint: string }
  | { kind: "readable"; fingerprint: string; base: Ledger; local: Ledger };

/** A short, stable digest of the stored text, so the store can tell "already imported" from "changed since". */
export function fingerprint(text: string): string {
  // cyrb53 (public domain): fast, and collisions don't matter beyond "this exact text".
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${text.length.toString(36)}-${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

function readText(storage: LegacyStorage | null, key: string): string | null | undefined {
  if (!storage) return undefined;
  try {
    return storage.getItem(key);
  } catch {
    return undefined;
  }
}

export function readLegacyCopy(storage: LegacyStorage | null, email: string): LegacyCopy {
  const text = readText(storage, legacyLedgerKey(email));
  if (text === undefined) return { kind: "unavailable" };
  if (text === null) return { kind: "none" };
  const print = fingerprint(text);
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value !== "object" || value === null || !("base" in value) || !("local" in value)) throw new Error("not a ledger pair");
    return { kind: "readable", fingerprint: print, base: parseLedger(value.base, { allowOldVersions: true }), local: parseLedger(value.local, { allowOldVersions: true }) };
  } catch {
    return { kind: "unreadable", fingerprint: print };
  }
}

/** Removes the legacy copy only if it is still exactly what was imported. Returns whether it is gone. */
export function removeLegacyCopy(storage: LegacyStorage | null, email: string, expected: string): boolean {
  const text = readText(storage, legacyLedgerKey(email));
  if (text === null) return true;
  if (text === undefined || !storage || fingerprint(text) !== expected) return false;
  try {
    storage.removeItem(legacyLedgerKey(email));
    return true;
  } catch {
    return false;
  }
}

/**
 * Moves an unreadable legacy copy aside (`….unreadable-<time>`) so it stops blocking sign-out, while
 * keeping its text in the browser for support. Throws if the browser refuses (for example, no room
 * for the copy); then nothing changed.
 */
export function setLegacyCopyAside(storage: LegacyStorage | null, email: string, at: string): void {
  if (!storage) throw new Error("This browser isn't letting Penny change its saved data.");
  const text = storage.getItem(legacyLedgerKey(email));
  if (text === null) return;
  storage.setItem(legacyAsideKey(email, at), text);
  storage.removeItem(legacyLedgerKey(email));
}
