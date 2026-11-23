/**
 * Codes that arrive in a link's fragment (MAZ-124): the password reset link
 * `/reset-password#code=<64 hex>` and the invitation link `/join#code=<10 hex>`. A fragment never
 * reaches the server or its logs; the routes read it once, keep the code here and drop it from the
 * address bar, so it isn't left in the history, a bookmark or a shared screenshot.
 *
 * The reset code is a credential, so it stays in memory only: reloading the page asks for the
 * code instead. The invite code waits in sessionStorage, so it survives a sign-in round trip
 * through the identity provider in this tab, and is removed once the join dialog is done with it.
 */
import { RESET_CODE } from "../api/schemas";

/** The `code` parameter of a fragment such as `code=abc` (TanStack's `location.hash` has no `#`). */
export function fragmentCode(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get("code");
  return value ? value.trim() : null;
}

/* ---------- password reset ---------- */

let resetCode: string | null = null;

/** Keeps a reset code from the emailed link. Anything that isn't one is ignored. */
export function keepResetCode(code: string | null): void {
  const value = code?.toLowerCase() ?? "";
  if (RESET_CODE.test(value)) resetCode = value;
}

/** The kept reset code, if a link brought one. */
export const peekResetCode = (): string | null => resetCode;

/** Forgets the reset code once it is used (or the person leaves for another way in). */
export function clearResetCode(): void {
  resetCode = null;
}

/* ---------- invitation by email ---------- */

const JOIN_KEY = "penny.join-code";
const JOIN_CODE = /^[A-F0-9]{10}$/;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Keeps an invite code from the emailed link until the join dialog opens with it. */
export function keepJoinCode(code: string | null): void {
  const value = code?.replace(/[\s·.-]/g, "").toUpperCase() ?? "";
  if (!JOIN_CODE.test(value)) return;
  storage()?.setItem(JOIN_KEY, value);
  for (const listener of listeners) listener();
}

export function peekJoinCode(): string | null {
  const value = storage()?.getItem(JOIN_KEY) ?? null;
  return value && JOIN_CODE.test(value) ? value : null;
}

export function clearJoinCode(): void {
  storage()?.removeItem(JOIN_KEY);
  for (const listener of listeners) listener();
}

/** For `useSyncExternalStore`: notified when a code is kept or cleared. */
export function subscribeJoinCode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
