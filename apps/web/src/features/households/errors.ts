import { z } from "zod";
import { ApiError } from "../../api/client";
import type { LedgerSnapshot } from "../../api/ledger";
import type { SharedCategory } from "../../api/schemas";

export type SharedErrorKind = "offline" | "unreachable" | "conflict" | "membership" | "rate" | "invalid" | "other";

export interface SharedError {
  kind: SharedErrorKind;
  message: string;
}

/**
 * Turns a failed shared write into what the person should know and do next. Shared data is
 * online-only, so a network failure says that the draft is kept and to try again online; a 404
 * from a household that was readable a moment ago means membership changed (left, removed or
 * archived elsewhere); 409s are the server's own conflict or restriction text.
 */
export function describeSharedError(error: unknown): SharedError {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      return offline
        ? { kind: "offline", message: "You're offline. Shared households need a connection, so nothing was sent." }
        : { kind: "unreachable", message: "Penny can't reach the server, so nothing was sent." };
    }
    if (error.status === 404 && /household not found/i.test(error.message)) {
      return { kind: "membership", message: "You're no longer a member of this household, or it was archived. Nothing was changed." };
    }
    if (error.status === 409) return { kind: "conflict", message: error.message };
    if (error.status === 429) return { kind: "rate", message: "Too many attempts. Wait a few minutes and try again." };
    if (error.status >= 500) return { kind: "other", message: "The server had a problem, so nothing was saved. Try again in a moment." };
    return { kind: "invalid", message: error.message };
  }
  return { kind: "other", message: "Something went wrong, so nothing was saved." };
}

/** A read that failed: what to say on the page. */
export function describeLoadError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return navigator.onLine ? "Penny can't reach the server." : "You're offline. Shared households need a connection.";
    if (error.status === 404) return "This household isn't available to you. You may have left it, or it was archived.";
  }
  return "Nothing was changed. Try again in a moment.";
}

/* ---------- the parts of the personal ledger the shared form offers ---------- */

const accountSchema = z.object({ id: z.string().min(1), name: z.string(), type: z.string().optional() });
const categorySchema = z.object({ id: z.string(), name: z.string().min(1).max(50), icon: z.string().max(80), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/), kind: z.string() });

export interface LedgerChoices {
  accounts: { id: string; name: string }[];
  categories: SharedCategory[];
}

export const FALLBACK_CATEGORY: SharedCategory = { name: "Other", icon: "pricetag", color: "#8E8E93" };

/**
 * Accounts and expense categories from the personal ledger, read loosely (anything malformed is
 * skipped). The account list is only ever offered to the payer, for their own private account.
 */
export function ledgerChoices(snapshot: LedgerSnapshot | undefined): LedgerChoices {
  const ledger = snapshot?.ledger as Record<string, unknown> | undefined;
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);
  const accounts = list(ledger?.accounts).flatMap((item) => {
    const parsed = accountSchema.safeParse(item);
    return parsed.success ? [{ id: parsed.data.id, name: parsed.data.name }] : [];
  });
  const categories = list(ledger?.categories).flatMap((item) => {
    const parsed = categorySchema.safeParse(item);
    return parsed.success && parsed.data.kind === "expense" ? [{ name: parsed.data.name, icon: parsed.data.icon, color: parsed.data.color }] : [];
  });
  return { accounts, categories: categories.length ? categories : [FALLBACK_CATEGORY] };
}
