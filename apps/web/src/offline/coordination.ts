/**
 * Cross-tab coordination for the offline store.
 *
 * - `withLock` runs one sync per account at a time across every tab of the origin (Web Locks API),
 *   falling back to one-at-a-time within this page where the API is missing (old browsers, jsdom).
 *   Correctness never depends on the lock: every write is an atomic IndexedDB transaction and the
 *   server compares revisions. The lock only stops tabs from racing each other into 409s.
 * - `ledgerChannel` tells the other tabs that an account's stored ledger changed, so they re-read it.
 */
export type LockRunner = <T>(name: string, task: () => Promise<T>) => Promise<T>;

const localQueues = new Map<string, Promise<unknown>>();

function withLocalLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  const previous = localQueues.get(name) ?? Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.catch(() => undefined);
  localQueues.set(name, settled);
  void settled.then(() => {
    if (localQueues.get(name) === settled) localQueues.delete(name);
  });
  return run;
}

export const withLock: LockRunner = (name, task) => {
  const locks = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks && typeof locks.request === "function") return locks.request(name, task);
  return withLocalLock(name, task);
};

export interface LedgerChannel {
  post(key: string): void;
  close(): void;
}

export const CHANNEL_NAME = "penny-offline-ledger";

/** One channel per engine. `onChange` hears other tabs' (and other engines') writes, never its own posts. */
export function openLedgerChannel(onChange: (key: string) => void): LedgerChannel {
  if (typeof BroadcastChannel === "undefined") return { post: () => undefined, close: () => undefined };
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (typeof data === "object" && data !== null && "key" in data && typeof data.key === "string") onChange(data.key);
  };
  return {
    post: (key) => {
      channel.postMessage({ key });
    },
    close: () => {
      channel.close();
    },
  };
}
