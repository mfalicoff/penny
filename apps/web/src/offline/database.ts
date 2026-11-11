/**
 * Where the browser keeps each account's offline ledger. IndexedDB in the app; an in-memory copy
 * in tests. Writes are atomic read-modify-write steps (`update`), and IndexedDB serializes
 * overlapping read-write transactions across every tab of the origin, so two tabs saving at once
 * can never overwrite each other's change.
 */
export interface LedgerDatabase {
  get(key: string): Promise<unknown>;
  /**
   * Reads `key`, then stores what `change` returns, in one transaction. `next: undefined` leaves the
   * value as it is and `next: null` deletes it. `change` must be synchronous; if it throws, nothing
   * is written and the error is rethrown.
   */
  update<T>(key: string, change: (current: unknown) => { next?: unknown; result: T }): Promise<T>;
  keys(): Promise<string[]>;
  close(): void;
}

export type StorageFailure = "unavailable" | "quota" | "failed" | "closed";

/**
 * The browser refused to store or read data. `unavailable`: no IndexedDB (blocked, or an old private
 * mode). `closed`: this tab's connection was closed for a newer build's upgrade (or by the browser),
 * and only a reload opens it again.
 */
export class StorageError extends Error {
  readonly failure: StorageFailure;

  constructor(failure: StorageFailure, options?: { cause?: unknown }) {
    super(
      failure === "quota"
        ? "This browser is out of storage space for Penny."
        : failure === "unavailable"
          ? "This browser isn't letting Penny store data."
          : failure === "closed"
            ? "Penny was updated in another tab. Reload the page to keep working."
            : "This browser couldn't store Penny's data.",
      options,
    );
    this.name = "StorageError";
    this.failure = failure;
  }
}

function storageError(cause: unknown): StorageError {
  if (cause instanceof StorageError) return cause;
  const name = cause instanceof DOMException || cause instanceof Error ? cause.name : "";
  if (name === "QuotaExceededError") return new StorageError("quota", { cause });
  if (name === "SecurityError" || name === "InvalidStateError") return new StorageError("unavailable", { cause });
  return new StorageError("failed", { cause });
}

export const DATABASE_NAME = "penny-offline";
const DATABASE_VERSION = 1;
const LEDGERS = "ledgers";

function request<T>(target: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    target.onsuccess = () => {
      resolve(target.result);
    };
    target.onerror = () => {
      reject(storageError(target.error));
    };
  });
}

/**
 * Opens (or creates) the `penny-offline` database. Schema v1 has one object store, `ledgers`,
 * keyed by `recordKey(server, email)`. A later schema bumps `DATABASE_VERSION` and migrates in
 * `onupgradeneeded`, never dropping a store that may hold unsynced work.
 */
export async function openIndexedDb(factory?: IDBFactory, name = DATABASE_NAME): Promise<LedgerDatabase> {
  // Missing entirely in some locked-down or very old private modes.
  const target = factory ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!target) throw new StorageError("unavailable");
  let opening: IDBOpenDBRequest;
  try {
    opening = target.open(name, DATABASE_VERSION);
  } catch (cause) {
    throw storageError(cause);
  }
  opening.onupgradeneeded = () => {
    const db = opening.result;
    if (!db.objectStoreNames.contains(LEDGERS)) db.createObjectStore(LEDGERS);
  };
  let db: IDBDatabase;
  try {
    db = await request(opening);
  } catch (cause) {
    throw new StorageError(cause instanceof StorageError && cause.failure === "quota" ? "quota" : "unavailable", { cause });
  }
  // A newer build in another tab wants to upgrade the schema: let it rather than block it. This
  // build can't reopen the database afterwards (the old version no longer opens), so every later
  // call fails with `closed` and the engine asks the person to reload into the new build. The
  // browser can also close the connection itself (site data cleared): same outcome.
  let closed = false;
  db.onversionchange = () => {
    closed = true;
    db.close();
  };
  db.onclose = () => {
    closed = true;
  };

  function transaction(mode: IDBTransactionMode): IDBTransaction {
    if (closed) throw new StorageError("closed");
    try {
      // `strict`: the write is on disk before the transaction completes, so a save is acknowledged
      // only once it would survive a crash (Chromium defaults to relaxed).
      return db.transaction(LEDGERS, mode, { durability: "strict" });
    } catch (cause) {
      throw storageError(cause);
    }
  }

  return {
    async get(key) {
      return request<unknown>(transaction("readonly").objectStore(LEDGERS).get(key));
    },
    update(key, change) {
      return new Promise((resolve, reject) => {
        let tx: IDBTransaction;
        try {
          tx = transaction("readwrite");
        } catch (cause) {
          reject(storageError(cause));
          return;
        }
        const store = tx.objectStore(LEDGERS);
        let outcome: { result: unknown } | null = null;
        let failure: unknown = null;
        const read = store.get(key);
        read.onsuccess = () => {
          try {
            const { next, result } = change(read.result);
            outcome = { result };
            if (next === null) store.delete(key);
            else if (next !== undefined) store.put(next, key);
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
        tx.oncomplete = () => {
          if (outcome) resolve(outcome.result as never);
          else reject(new StorageError("failed"));
        };
        tx.onabort = () => {
          reject(failure instanceof Error ? failure : storageError(tx.error));
        };
      });
    },
    async keys() {
      const keys = await request(transaction("readonly").objectStore(LEDGERS).getAllKeys());
      return keys.filter((key): key is string => typeof key === "string");
    },
    close() {
      closed = true;
      db.close();
    },
  };
}

/**
 * An in-memory database for tests and the multi-tab harness: values are structured-cloned like
 * IndexedDB's, and `failWith` makes the next writes fail (a full disk, a revoked permission).
 */
export class MemoryLedgerDatabase implements LedgerDatabase {
  readonly values = new Map<string, unknown>();
  failWith: StorageError | null = null;
  failReads: StorageError | null = null;
  writes = 0;
  private queue: Promise<unknown> = Promise.resolve();

  get(key: string): Promise<unknown> {
    return this.serialize(() => {
      if (this.failReads) throw this.failReads;
      return structuredClone(this.values.get(key));
    });
  }

  update<T>(key: string, change: (current: unknown) => { next?: unknown; result: T }): Promise<T> {
    return this.serialize(() => {
      if (this.failReads) throw this.failReads;
      const { next, result } = change(structuredClone(this.values.get(key)));
      if (next !== undefined) {
        if (this.failWith) throw this.failWith;
        this.writes += 1;
        if (next === null) this.values.delete(key);
        else this.values.set(key, structuredClone(next));
      }
      return result;
    });
  }

  keys(): Promise<string[]> {
    return this.serialize(() => [...this.values.keys()]);
  }

  close(): void {
    // Nothing to release.
  }

  private serialize<T>(step: () => T): Promise<T> {
    const run = this.queue.then(step);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
