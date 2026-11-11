import type { Ledger } from "@domain/ledger.ts";

/**
 * What this browser has not synced yet: the difference between the last ledger the server
 * acknowledged (`base`) and this browser's copy (`local`). There is no separate queue that could
 * disagree with the ledgers themselves (the same rule as the native `PendingChanges`).
 */
export interface PendingSummary {
  /** Records created, edited or deleted, plus one for a currency change. */
  count: number;
  /** Entries created or edited here and not synced ("Waiting to sync" rows). */
  entryIds: string[];
  /** Entries deleted here and not synced. */
  deletedEntryIds: string[];
}

export const NOTHING_PENDING: PendingSummary = Object.freeze({ count: 0, entryIds: [], deletedEntryIds: [] });

type Item = { id: string };

function diff(base: readonly Item[], local: readonly Item[]) {
  const before = new Map(base.map((item) => [item.id, JSON.stringify(item)]));
  const after = new Set(local.map((item) => item.id));
  const changed = local.filter((item) => before.get(item.id) !== JSON.stringify(item)).map((item) => item.id);
  const deleted = base.filter((item) => !after.has(item.id)).map((item) => item.id);
  return { changed, deleted };
}

export function pendingChanges(base: Ledger, local: Ledger): PendingSummary {
  let count = base.currency === local.currency ? 0 : 1;
  for (const list of ["accounts", "trips", "categories", "recurring"] as const) {
    const { changed, deleted } = diff(base[list], local[list]);
    count += changed.length + deleted.length;
  }
  const entries = diff(base.transactions, local.transactions);
  count += entries.changed.length + entries.deleted.length;
  return count === 0 ? NOTHING_PENDING : { count, entryIds: entries.changed, deletedEntryIds: entries.deleted };
}
