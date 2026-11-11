import { z } from "zod";
import { upgradeLedger, type Ledger } from "@domain/ledger.ts";

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
// v1–v3 only reach the browser from an old local copy; the API always answers v4.
const ledgerOld = z.looseObject({
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  accounts: z.array(z.looseObject({ id, name: z.string() })).optional(),
  trips: z.array(record).optional(),
  ...lists,
});

/** The server (or a stored copy) holds a ledger this build can't work on. Nothing is written over it. */
export class IncompatibleLedgerError extends Error {
  constructor(message = "Penny can't read this ledger. Update the app, then try again.", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "IncompatibleLedgerError";
  }
}

/**
 * Plain JSON: no `undefined` fields, no shared references. Comparisons use `JSON.stringify`, as the
 * shared merge does, so every ledger the store keeps goes through here once.
 */
export function normalizeLedger(ledger: Ledger): Ledger {
  return JSON.parse(JSON.stringify(ledger)) as Ledger;
}

/** Reads a wire ledger, upgrading v1–v3. Throws `IncompatibleLedgerError` for anything else. */
export function parseLedger(value: unknown, options: { allowOldVersions?: boolean } = {}): Ledger {
  const current = ledgerV4.safeParse(value);
  if (current.success) return normalizeLedger(current.data as unknown as Ledger);
  if (options.allowOldVersions) {
    const old = ledgerOld.safeParse(value);
    if (old.success) return normalizeLedger(upgradeLedger(old.data as unknown as Parameters<typeof upgradeLedger>[0]));
  }
  throw new IncompatibleLedgerError(undefined, { cause: current.error });
}

export function sameLedger(a: Ledger, b: Ledger): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A `GET`/`PUT /api/ledger` answer whose ledger passed `parseLedger`. */
export type ServerSnapshot = { revision: number; ledger: Ledger };
