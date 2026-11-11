import { z } from "zod";
import type { Ledger } from "@domain/ledger.ts";
import { IncompatibleLedgerError, parseLedger } from "./wire";

/** The stored record's schema version. A build reads its own format and refuses a higher one. */
export const RECORD_FORMAT = 1;

/**
 * One account's offline ledger in the `ledgers` store (format 1). `base` is the last ledger the
 * server acknowledged, `local` is `base` plus this browser's unsynced changes. Both are v4 wire
 * ledgers. The server (the page's origin) and lowercased email are repeated inside, so a record
 * under the wrong key is never shown to the wrong person.
 */
export interface LedgerRecord {
  format: typeof RECORD_FORMAT;
  server: string;
  email: string;
  /** The revision `base` was read or written at. `null` for a copy imported from the legacy web app, which kept none. */
  baseRevision: number | null;
  base: Ledger;
  local: Ledger;
  lastSyncedAt: string | null;
  savedAt: string;
  /** Set when this record took in the legacy web app's copy (see `legacy.ts`). */
  legacy?: { fingerprint: string; importedAt: string; removedAt?: string };
}

export interface AccountScope {
  /** The page's origin, e.g. `https://penny.example.com`. */
  server: string;
  /** Lowercased. */
  email: string;
}

export function accountScope(server: string, email: string): AccountScope {
  return { server, email: email.trim().toLowerCase() };
}

export const recordKey = (scope: AccountScope) => `ledger\n${scope.server}\n${scope.email}`;

export type RecordProblem = "unreadable" | "newerFormat" | "wrongAccount";

/** The stored copy can't be used. It is never overwritten silently; see `recoverUnreadable`. */
export class RecordError extends Error {
  readonly problem: RecordProblem;

  constructor(problem: RecordProblem, options?: { cause?: unknown }) {
    super(
      problem === "newerFormat"
        ? "A newer version of Penny saved data in this browser. Reload the page to update Penny."
        : "Penny can't read what it saved in this browser.",
      options,
    );
    this.name = "RecordError";
    this.problem = problem;
  }
}

const recordShape = z.object({
  format: z.number().int(),
  server: z.string(),
  email: z.string(),
  baseRevision: z.number().int().min(0).nullable(),
  base: z.unknown(),
  local: z.unknown(),
  lastSyncedAt: z.string().nullable(),
  savedAt: z.string(),
  legacy: z.object({ fingerprint: z.string(), importedAt: z.string(), removedAt: z.string().optional() }).optional(),
});

function ledgerVersion(value: unknown): number {
  return typeof value === "object" && value !== null && "version" in value && typeof value.version === "number" ? value.version : 0;
}

/** Reads a stored value. `undefined` means nothing is stored; anything unusable throws `RecordError`. */
export function parseRecord(value: unknown, scope: AccountScope): LedgerRecord | null {
  if (value === undefined) return null;
  const shape = recordShape.safeParse(value);
  if (!shape.success) {
    const format = typeof value === "object" && value !== null && "format" in value ? value.format : undefined;
    if (typeof format === "number" && format > RECORD_FORMAT) throw new RecordError("newerFormat");
    throw new RecordError("unreadable", { cause: shape.error });
  }
  const data = shape.data;
  if (data.format > RECORD_FORMAT) throw new RecordError("newerFormat");
  if (data.format !== RECORD_FORMAT) throw new RecordError("unreadable");
  if (data.server !== scope.server || data.email !== scope.email) throw new RecordError("wrongAccount");
  try {
    const record: LedgerRecord = {
      format: RECORD_FORMAT,
      server: data.server,
      email: data.email,
      baseRevision: data.baseRevision,
      base: parseLedger(data.base),
      local: parseLedger(data.local),
      lastSyncedAt: data.lastSyncedAt,
      savedAt: data.savedAt,
    };
    if (data.legacy) {
      record.legacy = {
        fingerprint: data.legacy.fingerprint,
        importedAt: data.legacy.importedAt,
        ...(data.legacy.removedAt ? { removedAt: data.legacy.removedAt } : {}),
      };
    }
    return record;
  } catch (cause) {
    const newer = cause instanceof IncompatibleLedgerError && [data.base, data.local].some((ledger) => ledgerVersion(ledger) > 4);
    throw new RecordError(newer ? "newerFormat" : "unreadable", { cause });
  }
}

/** Unreadable copies are kept under this key, never deleted, until the account is removed from the browser. */
export const asideKey = (scope: AccountScope, at: string) => `aside\n${scope.server}\n${scope.email}\n${at}`;
export const isAsideKeyOf = (scope: AccountScope, key: string) => key.startsWith(`aside\n${scope.server}\n${scope.email}\n`);
