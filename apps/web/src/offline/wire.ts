import { z } from "zod";
import type { Ledger } from "@domain/ledger.ts";

/**
 * The personal ledger as the API sends it (`contracts/openapi.json` `Ledger`), checked just enough
 * for the offline store to work on it safely: every record has an id, entries and rules have the
 * fields that merge, recurrence and search read. Unknown fields are kept (`looseObject`), so a
 * write sends back exactly what was read plus this browser's changes.
 */
const id = z.string().min(1).max(100);
const kind = z.enum(["expense", "income", "investment"]);
const record = z.looseObject({ id });
const entry = z.looseObject({
  id,
  title: z.string(),
  kind,
  total: z.number().int(),
  share: z.number().int(),
  categoryId: z.string(),
  accountId: z.string().optional(),
  date: z.string(),
  note: z.string(),
});
const rule = entry.extend({
  frequency: z.enum(["weekly", "monthly", "yearly"]),
  nextDate: z.string(),
  anchorDay: z.number().int().min(1).max(31),
  active: z.boolean(),
});
const lists = {
  currency: z.string().min(1),
  categories: z.array(z.looseObject({ id, name: z.string(), kind })),
  transactions: z.array(entry),
  recurring: z.array(rule),
};
const ledgerV4 = z.looseObject({ version: z.literal(4), accounts: z.array(z.looseObject({ id, name: z.string() })), trips: z.array(record), ...lists });

/** The server (or a stored copy) holds a ledger this build can't work on. Nothing is written over it. */
export class IncompatibleLedgerError extends Error {
  constructor(message = "Penny can't read this ledger. Update the app, then try again.", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "IncompatibleLedgerError";
  }
}

/**
 * Plain JSON: no `undefined` fields, no shared references. Comparisons use `JSON.stringify`, as the
 * shared merge and the shared commands' stale checks do, so every ledger the store keeps goes
 * through here once. Keys are put in the order `parseLedger` gives them (schema fields first, then
 * unknown ones), so the copy screens hold matches what a later read of the store returns. Without
 * that, a record built in memory (say `{id,name,icon,color,kind}`) and the same record read back
 * (`{id,name,kind,icon,color}`) look like an edit from another device.
 */
export function normalizeLedger(ledger: Ledger): Ledger {
  const plain: unknown = JSON.parse(JSON.stringify(ledger));
  const ordered = ledgerV4.safeParse(plain);
  return (ordered.success ? JSON.parse(JSON.stringify(ordered.data)) : plain) as Ledger;
}

/** Reads a v4 wire ledger. Throws `IncompatibleLedgerError` for anything else. */
export function parseLedger(value: unknown): Ledger {
  const current = ledgerV4.safeParse(value);
  if (current.success) return normalizeLedger(current.data as unknown as Ledger);
  throw new IncompatibleLedgerError(undefined, { cause: current.error });
}

export function sameLedger(a: Ledger, b: Ledger): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A `GET`/`PUT /api/ledger` answer whose ledger passed `parseLedger`. */
export type ServerSnapshot = { revision: number; ledger: Ledger };
