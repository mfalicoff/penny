import { afterEach, vi } from "vitest";
import type { Ledger, Recurring, Transaction } from "@domain/ledger.ts";
import { ApiError } from "../../src/api/client";
import type { LedgerChannel } from "../../src/offline/coordination";
import { MemoryLedgerDatabase, type LedgerDatabase } from "../../src/offline/database";
import { LedgerSyncEngine, type LedgerApi } from "../../src/offline/engine";
import type { LegacyStorage } from "../../src/offline/legacy";
import { parseLedger, type ServerSnapshot } from "../../src/offline/wire";

/** Synthetic data only: made-up names and amounts. */
export const SERVER = "https://penny.test";
export const ALEX = "alex@example.test";
export const BOB = "bob@example.test";
export const TODAY = "2026-11-10";

export function entry(id: string, title = id, extra: Partial<Transaction> = {}): Transaction {
  return { id, title, kind: "expense", total: 1200, share: 1200, categoryId: "groceries", date: "2026-11-02", note: "", ...extra };
}

export function rule(id: string, extra: Partial<Recurring> = {}): Recurring {
  return {
    id,
    title: "Transit pass",
    kind: "expense",
    total: 6200,
    share: 6200,
    categoryId: "groceries",
    date: "2026-10-01",
    note: "",
    frequency: "monthly",
    nextDate: "2026-12-01",
    anchorDay: 1,
    active: true,
    ...extra,
  };
}

export function ledger(extra: Partial<Ledger> = {}): Ledger {
  return {
    version: 4,
    currency: "CAD",
    accounts: [],
    trips: [],
    categories: [{ id: "groceries", name: "Groceries", icon: "basket-outline", color: "#6C9C79", kind: "expense" }],
    transactions: [],
    recurring: [],
    ...extra,
  };
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * The API's `GET`/`PUT /api/ledger`: whole-ledger compare-and-swap on `revision`, 409 on a stale
 * write, never a merge. `otherDevice` edits it as another client (the iOS app) would.
 */
export class FakeServer {
  revision = 1;
  ledger: Ledger;
  reachable = true;
  /** Statuses to answer the next requests with, in order (e.g. [503], [409, 409]). */
  failures: number[] = [];
  /** Runs before a PUT is checked, e.g. another device writing in between. */
  beforePut: ((snapshot: ServerSnapshot) => void) | null = null;
  /** When set, GET waits for this promise (to hold a request in flight). */
  getGate: Promise<void> | null = null;
  gets = 0;
  puts: ServerSnapshot[] = [];

  constructor(initial: Ledger = ledger()) {
    this.ledger = clone(initial);
  }

  otherDevice(change: (ledger: Ledger) => Ledger) {
    this.ledger = clone(change(clone(this.ledger)));
    this.revision += 1;
  }

  private check() {
    if (!this.reachable) throw new ApiError(0, "Penny can't reach the server.");
    const status = this.failures.shift();
    if (status !== undefined) throw new ApiError(status, `Failed (${status}).`);
  }

  api: LedgerApi = {
    get: async () => {
      this.gets += 1;
      if (this.getGate) await this.getGate;
      await Promise.resolve();
      this.check();
      // Parsed like the app's `ledgerApi`, so a ledger this build can't read fails the same way.
      return { revision: this.revision, ledger: parseLedger(clone(this.ledger)) };
    },
    put: async (snapshot) => {
      await Promise.resolve();
      this.check();
      this.beforePut?.(snapshot);
      if (snapshot.revision !== this.revision) throw new ApiError(409, "The ledger changed.");
      this.puts.push(clone(snapshot));
      this.ledger = clone(snapshot.ledger);
      this.revision += 1;
      // Parsed like the app's `ledgerApi`, so a ledger this build can't read fails the same way.
      return { revision: this.revision, ledger: parseLedger(clone(this.ledger)) };
    },
  };
}

/** A BroadcastChannel stand-in shared by the "tabs" of one test. */
export function channelHub() {
  const listeners = new Set<(key: string) => void>();
  return (onChange: (key: string) => void): LedgerChannel => {
    listeners.add(onChange);
    return {
      post: (key) => {
        for (const listener of listeners) if (listener !== onChange) queueMicrotask(() => {
          listener(key);
        });
      },
      close: () => {
        listeners.delete(onChange);
      },
    };
  };
}

export class MemoryStorage implements LegacyStorage {
  readonly items = new Map<string, string>();
  failWrites = false;
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new DOMException("Full", "QuotaExceededError");
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

// Every engine a test opened is stopped afterwards, so no retry timer or channel outlives it.
const openEngines = new Set<LedgerSyncEngine>();
afterEach(() => {
  for (const engine of openEngines) engine.stop();
  openEngines.clear();
});

export interface Tab {
  engine: LedgerSyncEngine;
  network: { online: boolean };
  expired: ReturnType<typeof vi.fn>;
  snapshots: { revision: number; changed: boolean }[];
}

export function openTab(options: {
  server: FakeServer;
  db?: LedgerDatabase | null;
  email?: string;
  legacy?: LegacyStorage | null;
  hub?: ReturnType<typeof channelHub>;
  online?: boolean;
  today?: () => string;
  start?: boolean;
}): Tab {
  const network = { online: options.online ?? true };
  const expired = vi.fn();
  const snapshots: Tab["snapshots"] = [];
  const db = options.db === undefined ? new MemoryLedgerDatabase() : options.db;
  const engine = new LedgerSyncEngine({
    server: SERVER,
    email: options.email ?? ALEX,
    api: options.server.api,
    openDatabase: () => (db ? Promise.resolve(db) : Promise.reject(new Error("IndexedDB is blocked"))),
    legacyStorage: options.legacy ?? null,
    onSessionExpired: expired,
    onServerSnapshot: (snapshot, changed) => {
      snapshots.push({ revision: snapshot.revision, changed });
    },
    online: () => network.online,
    visible: () => true,
    today: options.today ?? (() => TODAY),
    now: () => new Date(`${TODAY}T12:00:00Z`),
    sleep: () => Promise.resolve(),
    random: () => 0,
    channel: options.hub ?? channelHub(),
    events: null,
    requestPersistence: () => undefined,
  });
  if (options.start !== false) engine.start();
  openEngines.add(engine);
  return { engine, network, expired, snapshots };
}

/** Waits until the engine has loaded and no sync is running. */
export async function settled(tab: Tab) {
  await vi.waitFor(() => {
    const phase = tab.engine.getState().phase;
    if (phase === "loading" || phase === "syncing") throw new Error(`still ${phase}`);
  });
  await tab.engine.sync();
}

export const titles = (value: Ledger | null) => (value?.transactions ?? []).map((item) => item.title).sort();

export const add = (item: Transaction) => (value: Ledger): Ledger => ({ ...value, transactions: [...value.transactions, item] });
export const edit = (id: string, fields: Partial<Transaction>) => (value: Ledger): Ledger => ({
  ...value,
  transactions: value.transactions.map((item) => (item.id === id ? { ...item, ...fields } : item)),
});
export const remove = (id: string) => (value: Ledger): Ledger => ({ ...value, transactions: value.transactions.filter((item) => item.id !== id) });
