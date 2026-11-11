import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";
import { ledgerQuery } from "../../api/ledger";
import type { SharedCategory } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { useLedgerSync } from "../../offline/OfflineLedgerProvider";

/* ---------- the parts of the personal ledger the shared form offers ---------- */

const accountSchema = z.object({ id: z.string().min(1), name: z.string(), type: z.string().optional() });
const categorySchema = z.object({ id: z.string(), name: z.string().min(1).max(50), icon: z.string().max(80), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/), kind: z.string() });

export interface LedgerAccountChoice {
  id: string;
  name: string;
  /**
   * Whether the server's copy of the ledger has this account. The server checks a shared expense's
   * account against it (`400 Payment account not found.`), so an account added on this device
   * can't be linked until it has synced.
   */
  synced: boolean;
}

export interface LedgerChoices {
  accounts: LedgerAccountChoice[];
  categories: SharedCategory[];
}

export const FALLBACK_CATEGORY: SharedCategory = { name: "Other", icon: "pricetag", color: "#8E8E93" };

const list = (value: unknown): unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);
const field = (ledger: unknown, name: string) => (typeof ledger === "object" && ledger !== null ? (ledger as Record<string, unknown>)[name] : undefined);

/**
 * Accounts and expense categories from the personal ledger, read loosely (anything malformed is
 * skipped). `ledger` is what this browser shows (pending changes included); `server` is the last
 * ledger the server acknowledged, which decides `synced` (unknown: every account counts as synced
 * and the server has the last word). The account list is only ever offered to the payer.
 */
export function ledgerChoices(ledger: unknown, server: unknown = ledger): LedgerChoices {
  const known = server === undefined ? null : new Set(list(field(server, "accounts")).flatMap((item) => {
    const parsed = accountSchema.safeParse(item);
    return parsed.success ? [parsed.data.id] : [];
  }));
  const accounts = list(field(ledger, "accounts")).flatMap((item) => {
    const parsed = accountSchema.safeParse(item);
    return parsed.success ? [{ id: parsed.data.id, name: parsed.data.name, synced: known?.has(parsed.data.id) ?? true }] : [];
  });
  const categories = list(field(ledger, "categories")).flatMap((item) => {
    const parsed = categorySchema.safeParse(item);
    return parsed.success && parsed.data.kind === "expense" ? [{ name: parsed.data.name, icon: parsed.data.icon, color: parsed.data.color }] : [];
  });
  return { accounts, categories: categories.length ? categories : [FALLBACK_CATEGORY] };
}

/**
 * The signed-in person's accounts and categories for shared forms: from the durable offline
 * ledger (MAZ-87), so ones created on this device and not yet synced are included, falling back to
 * the server copy in Query (the demo, or before the offline ledger loaded). Categories are sent by
 * value, so an unsynced one is safe to use; an unsynced account is marked (`synced: false`).
 */
export function useLedgerChoices(enabled = true): LedgerChoices {
  const email = useAccountEmail();
  const server = useQuery({ ...ledgerQuery(email), enabled });
  const local = useLedgerSync()?.ledger ?? null;
  const serverLedger = server.data?.ledger;
  return useMemo(() => ledgerChoices(local ?? serverLedger, serverLedger), [local, serverLedger]);
}
