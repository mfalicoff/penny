import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { LedgerChange } from "@domain/commands.ts";
import type { Ledger } from "@domain/ledger.ts";
import { ApiError } from "../../api/client";
import { ledgerKey, ledgerQuery, setLedgerSnapshot, toLedgerSnapshot, writeLedgerSnapshot, type LedgerSnapshot } from "../../api/ledger";
import { invalidateSearch } from "../../api/search";
import { useAccountEmail } from "../../auth/account";
import { useIsDemo } from "../../demo/demo";
import { LedgerSaveError, type LedgerSyncState, type SaveReceipt } from "../../offline/engine";
import { useLedgerEngine, useLedgerSync } from "../../offline/OfflineLedgerProvider";
import { parseLedger } from "../../offline/wire";

/**
 * The personal ledger as the account and category screens use it.
 *
 * - Signed in: the durable offline ledger (MAZ-87). What is shown includes this browser's unsynced
 *   changes, and `save` commits a change to IndexedDB before resolving, so it works offline and
 *   syncs later. The engine's base (the last ledger the server acknowledged) tells which records
 *   are still waiting to sync, also after a reload while the server is unreachable.
 * - Demo: there is no store, so the Query copy is shown and `save` writes the snapshot back with
 *   its revision (a 409 reloads it), like Settings › Currency.
 */
export interface LedgerWorkspace {
  status: "loading" | "ready" | "error";
  ledger: Ledger | null;
  /** The last ledger the server acknowledged, when known. */
  server: Ledger | null;
  /** Why the ledger couldn't load (status `error`). */
  loadError: string | null;
  retry: () => void;
  retrying: boolean;
  save: (change: LedgerChange) => Promise<SaveReceipt>;
  /** The engine's state; null in the demo. */
  sync: LedgerSyncState | null;
}

function readLedger(value: unknown): Ledger | null {
  try {
    return parseLedger(value);
  } catch {
    return null;
  }
}

export function useLedgerWorkspace(): LedgerWorkspace {
  const email = useAccountEmail();
  const demo = useIsDemo();
  const engine = useLedgerEngine();
  const sync = useLedgerSync();
  const queryClient = useQueryClient();
  // Signed in, the engine downloads the ledger and keeps the server's copy (its base). The demo
  // has no engine, so it reads the Query copy itself.
  const query = useQuery({ ...ledgerQuery(email), enabled: demo || !engine });
  const queried = useMemo(() => (query.data ? readLedger(query.data.ledger) : null), [query.data]);
  const server = engine ? (sync?.base ?? null) : queried;

  const save = useCallback(
    async (change: LedgerChange): Promise<SaveReceipt> => {
      if (engine) return engine.save(change);
      const snapshot = queryClient.getQueryData<LedgerSnapshot>(ledgerKey(email));
      const current = snapshot ? readLedger(snapshot.ledger) : null;
      if (!snapshot || !current) throw new LedgerSaveError("notLoaded");
      let next: Ledger;
      try {
        next = change(current);
      } catch (error) {
        throw new LedgerSaveError("rule", error instanceof Error ? error.message : undefined, { cause: error });
      }
      try {
        const answer = toLedgerSnapshot(await writeLedgerSnapshot({ revision: snapshot.revision, ledger: next }));
        if (answer) setLedgerSnapshot(queryClient, email, answer);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) void queryClient.invalidateQueries({ queryKey: ledgerKey(email) });
        throw error;
      }
      void invalidateSearch(queryClient, email);
      return { savedOffline: false };
    },
    [engine, queryClient, email],
  );

  if (engine) {
    const ledger = sync?.ledger ?? null;
    const waiting = !sync || sync.phase === "loading" || sync.phase === "syncing";
    return {
      status: ledger ? "ready" : waiting ? "loading" : "error",
      ledger,
      server,
      loadError: ledger || waiting ? null : (sync.issue?.message ?? "Penny couldn't download your ledger."),
      retry: () => {
        void engine.syncNow().catch(() => undefined);
      },
      retrying: sync?.phase === "syncing",
      save,
      sync,
    };
  }

  const ledger = queried;
  return {
    status: ledger ? "ready" : query.isPending ? "loading" : "error",
    ledger,
    server,
    loadError: ledger ? null : query.error instanceof ApiError && query.error.status === 0 ? "Penny can't reach the server." : query.isError ? "Nothing was changed. Try again in a moment." : "Penny can't read this ledger.",
    retry: () => {
      void query.refetch();
    },
    retrying: query.isFetching,
    save,
    sync: null,
  };
}

/** A failed save, in words: the shared rule's message, the store's reason, or the server's answer. */
export function describeSaveError(error: unknown): string {
  if (error instanceof LedgerSaveError) return error.message;
  if (error instanceof ApiError) {
    if (error.status === 409) return "Your ledger changed somewhere else, so Penny reloaded it. Check your changes and save again.";
    if (error.status === 0) return "Penny can't reach the server.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

/** The toast detail after a save: whether it waits in this browser for the network. */
export const savedDetail = (receipt: SaveReceipt) => (receipt.savedOffline ? "Saved on this device. It syncs when you're back online." : undefined);

/** `savedDetail` as toast fields (no `detail` key when there's nothing to add). */
export const detailOf = (receipt: SaveReceipt): { detail?: string } => {
  const detail = savedDetail(receipt);
  return detail ? { detail } : {};
};
