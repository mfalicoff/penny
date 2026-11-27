import type { Ledger } from "@domain/ledger.ts";

/**
 * What this browser has not synced yet: the difference between the last ledger the server
 * acknowledged (`base`) and this browser's copy (`local`). There is no separate queue that could
 * disagree with the ledgers themselves (the same rule as the native `PendingChanges`).
 */
export interface PendingSummary {
  /** Records created, edited or deleted, plus one for a currency change and one per suggestion dismissed or brought back. */
  count: number;
  /** Entries created or edited here and not synced ("Waiting to sync" rows). */
  entryIds: string[];
  /** Entries deleted here and not synced. */
  deletedEntryIds: string[];
  /** Recurring schedules created, edited, paused or resumed here and not synced (MAZ-90). */
  ruleIds: string[];
}

export const NOTHING_PENDING: PendingSummary = Object.freeze({ count: 0, entryIds: [], deletedEntryIds: [], ruleIds: [] });

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
  for (const list of ["accounts", "trips", "categories"] as const) {
    const { changed, deleted } = diff(base[list], local[list]);
    count += changed.length + deleted.length;
  }
  const rules = diff(base.recurring, local.recurring);
  count += rules.changed.length + rules.deleted.length;
  const entries = diff(base.transactions, local.transactions);
  count += entries.changed.length + entries.deleted.length;
  // A dismissed suggestion, or an Undo, is a change to sync too (MAZ-290).
  const dismissedBefore = new Set(base.dismissedSuggestions ?? []);
  const dismissedNow = new Set(local.dismissedSuggestions ?? []);
  for (const item of dismissedNow) if (!dismissedBefore.has(item)) count += 1;
  for (const item of dismissedBefore) if (!dismissedNow.has(item)) count += 1;
  return count === 0 ? NOTHING_PENDING : { count, entryIds: entries.changed, deletedEntryIds: entries.deleted, ruleIds: rules.changed };
}
