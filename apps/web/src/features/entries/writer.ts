import type { LedgerChange } from "@domain/commands.ts";
import type { Ledger } from "@domain/ledger.ts";
import { useIsDemo } from "../../demo/demo";
import type { SaveReceipt } from "../../offline/engine";
import { useLedgerEngine, useLedgerSync } from "../../offline/OfflineLedgerProvider";

/**
 * How the entry forms write (MAZ-88): every personal change, including categories and accounts
 * created inline, is a `LedgerChange` handed to the durable offline store (`engine.save`, MAZ-87).
 * It is acknowledged once it is in IndexedDB and syncs with `PUT /api/ledger` from there, so a
 * save works offline and survives a reload. Nothing here calls the API directly.
 */
export interface LedgerWriter {
  /** The ledger to show and validate against (this browser's copy, pending changes included). Null until loaded. */
  ledger: Ledger | null;
  /** Null when this browser can't save: the demo, or storage the browser refuses. */
  save: ((change: LedgerChange) => Promise<SaveReceipt>) | null;
  /** Why saving isn't possible, shown instead of a form that can't save. */
  unavailable: string | null;
  /** Entry ids changed here and not synced yet. */
  pending: ReadonlySet<string>;
}

const EMPTY: ReadonlySet<string> = new Set<string>();

export function useLedgerWriter(): LedgerWriter {
  const engine = useLedgerEngine();
  const sync = useLedgerSync();
  const demo = useIsDemo();
  const pending = sync?.pending.entryIds.length ? new Set(sync.pending.entryIds) : EMPTY;
  if (demo || !engine || !sync) {
    return { ledger: null, save: null, pending, unavailable: "The demo doesn't save entries. Sign in to your own Penny server to add them." };
  }
  if (!sync.durable && sync.ledger) {
    return { ledger: sync.ledger, save: null, pending, unavailable: "This browser isn't letting Penny store data (private browsing or a site setting), so entries can't be saved here." };
  }
  return { ledger: sync.ledger, save: (change) => engine.save(change), pending, unavailable: null };
}
