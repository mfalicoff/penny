import { hashKey, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, use, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ratesQuery } from "../api/rates";
import type { ExchangeRates } from "../api/schemas";
import { provisionalDates, settleChange, settledEntries } from "./provisionalRates";
import { sessionKey } from "../api/keys";
import { ledgerKey, readLedgerSnapshot, setLedgerSnapshot, toLedgerSnapshot, writeLedgerSnapshot, type LedgerSnapshot } from "../api/ledger";
import { receiptExists } from "../api/receipts";
import { invalidateSearch } from "../api/search";
import { useAccountEmail } from "../auth/account";
import { expireSession } from "../auth/lifecycle";
import { registerPendingChanges } from "../auth/pendingChanges";
import { useIsDemo } from "../demo/demo";
import { openIndexedDb, type LedgerDatabase } from "./database";
import { LedgerSyncEngine, type LedgerApi, type LedgerSyncState } from "./engine";
import { parseLedger } from "./wire";

const EngineContext = createContext<LedgerSyncEngine | null>(null);

/** The signed-in account's offline engine, or null in the demo (which stores nothing). */
export function useLedgerEngine(): LedgerSyncEngine | null {
  return use(EngineContext);
}

const noSubscription = () => () => undefined;
const noState = () => null;

/** The account's ledger and sync status, re-rendering on every change. Null in the demo. */
export function useLedgerSync(): LedgerSyncState | null {
  const engine = use(EngineContext);
  return useSyncExternalStore(engine?.subscribe ?? noSubscription, engine?.getState ?? noState);
}

export const ledgerApi: LedgerApi = {
  async get() {
    const snapshot = await readLedgerSnapshot();
    return { revision: snapshot.revision, ledger: parseLedger(snapshot.ledger) };
  },
  async put(snapshot) {
    const answer = await writeLedgerSnapshot(snapshot);
    return { revision: answer.revision, ledger: parseLedger(answer.ledger) };
  },
  receiptExists,
};

export interface OfflineDependencies {
  openDatabase: () => Promise<LedgerDatabase>;
  api: LedgerApi;
}

const browserDependencies: OfflineDependencies = {
  openDatabase: () => openIndexedDb(),
  api: ledgerApi,
};

export function createAccountEngine(queryClient: QueryClient, email: string, dependencies: OfflineDependencies = browserDependencies): LedgerSyncEngine {
  const engine: LedgerSyncEngine = new LedgerSyncEngine({
    server: window.location.origin,
    email,
    api: dependencies.api,
    openDatabase: dependencies.openDatabase,
    onSessionExpired: () => {
      // Only the account this engine belongs to can be expired by its 401, never a newer session.
      const session = queryClient.getQueryData<{ email: string } | null>(sessionKey);
      if (session?.email === email) void expireSession(queryClient);
    },
    onServerSnapshot: (snapshot, changed) => {
      // Query keeps a server copy (Currency settings reads it); the durable store stays the source of pending work.
      // A sync that started before another write (Currency settings) must not put an older revision back.
      const copy = toLedgerSnapshot(snapshot);
      const cached = queryClient.getQueryData<LedgerSnapshot>(ledgerKey(email));
      if (copy && (!cached || cached.revision <= copy.revision)) setLedgerSnapshot(queryClient, email, copy);
      if (changed) void invalidateSearch(queryClient, email);
    },
  });
  return engine;
}

/**
 * Gives the signed-in account its durable offline ledger (MAZ-87). Mounted inside `AuthGate`, keyed
 * by account, so switching accounts stops the previous engine (its late answers are dropped) and
 * starts the next one. The demo gets none: it stores nothing.
 */
export function OfflineLedgerProvider({ children }: { children: ReactNode }) {
  const email = useAccountEmail();
  const demo = useIsDemo();
  if (demo) return <EngineContext value={null}>{children}</EngineContext>;
  return (
    <AccountLedger key={email} email={email}>
      {children}
    </AccountLedger>
  );
}

function AccountLedger({ email, children }: { email: string; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [engine] = useState(() => createAccountEngine(queryClient, email, offlineDependencies.current));

  useEffect(() => {
    engine.start();
    const unregister = registerPendingChanges({
      beginSignOut: (account) => (account === email ? engine.beginSignOut() : Promise.resolve(0)),
      cancelSignOut: (account) => {
        if (account === email) engine.cancelSignOut();
      },
      finishSignOut: (account, discardUpTo) => (account === email ? engine.finishSignOut(discardUpTo) : Promise.resolve()),
    });
    // A newer server ledger reached Query (for example, Currency settings saved one): sync, so the
    // durable copy's base catches up and pending work is merged onto it.
    // Runs on every cache event in the app, so compare Query's own precomputed hash.
    const ledgerHash = hashKey(ledgerKey(email));
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      if (event.query.queryHash !== ledgerHash) return;
      const data = event.query.state.data as LedgerSnapshot | undefined;
      if (data) engine.noteServerRevision(data.revision);
    });
    return () => {
      unsubscribe();
      unregister();
      engine.stop();
    };
  }, [engine, email, queryClient]);

  return (
    <EngineContext value={engine}>
      <ProvisionalRates engine={engine} email={email} />
      {children}
    </EngineContext>
  );
}

/**
 * After each sync that leaves the ledger up to date, replaces provisional rates the server has now
 * published (MAZ-151, `./provisionalRates.ts`), saving through the offline store like any edit.
 */
function ProvisionalRates({ engine, email }: { engine: LedgerSyncEngine; email: string }) {
  const queryClient = useQueryClient();
  const state = useSyncExternalStore(engine.subscribe, engine.getState);
  const running = useRef(false);
  const ledger = state.phase === "upToDate" ? state.ledger : null;
  const dates = ledger ? provisionalDates(ledger).join(",") : "";
  useEffect(() => {
    if (!ledger || !dates || running.current) return;
    running.current = true;
    const home = ledger.currency;
    void (async () => {
      try {
        const answers = new Map<string, ExchangeRates>();
        for (const date of dates.split(",")) {
          // A day's rates change once; a recent answer is fresh enough, and a sync often follows another.
          const answer = await queryClient.query({ ...ratesQuery(email, home, date), staleTime: 15 * 60_000 }).catch(() => null);
          if (answer) answers.set(date, answer);
        }
        const settled = settledEntries(ledger, answers);
        if (settled.length) await engine.save(settleChange(ledger.transactions, settled)).catch(() => undefined);
      } finally {
        running.current = false;
      }
    })();
  }, [dates, email, engine, ledger, queryClient]);
  return null;
}

/** Tests swap these for an in-memory database, fake storage or a fake API. */
export const offlineDependencies: { current: OfflineDependencies } = { current: browserDependencies };
