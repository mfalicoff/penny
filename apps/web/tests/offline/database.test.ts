import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { openIndexedDb, StorageError } from "../../src/offline/database";

describe("IndexedDB ledger database", () => {
  it("stores, reads, lists and deletes values across connections", async () => {
    const factory = new IDBFactory();
    const one = await openIndexedDb(factory);
    await one.update("k", () => ({ next: { value: 1 }, result: null }));
    const two = await openIndexedDb(factory);
    expect(await two.get("k")).toEqual({ value: 1 });
    expect(await two.keys()).toEqual(["k"]);
    await two.update("k", () => ({ next: null, result: null }));
    expect(await one.get("k")).toBeUndefined();
    one.close();
    two.close();
  });

  it("writes nothing when the change throws, and rethrows its error", async () => {
    const db = await openIndexedDb(new IDBFactory());
    await db.update("k", () => ({ next: { value: 1 }, result: null }));
    const refusal = new Error("refused");
    await expect(
      db.update("k", () => {
        throw refusal;
      }),
    ).rejects.toBe(refusal);
    expect(await db.get("k")).toEqual({ value: 1 });
    db.close();
  });

  it("never loses an update when two tabs write at once", async () => {
    const factory = new IDBFactory();
    const tabs = await Promise.all([openIndexedDb(factory), openIndexedDb(factory), openIndexedDb(factory)]);
    const increment = (db: (typeof tabs)[number]) =>
      db.update("counter", (current) => {
        const next = typeof current === "number" ? current + 1 : 1;
        return { next, result: next };
      });
    await Promise.all(tabs.flatMap((db) => [increment(db), increment(db), increment(db), increment(db)]));
    expect(await tabs[0].get("counter")).toBe(12);
    for (const db of tabs) db.close();
  });

  it("lets a newer build upgrade the schema, then reports every call as closed", async () => {
    const factory = new IDBFactory();
    const db = await openIndexedDb(factory, "upgrade-test");
    await db.update("k", () => ({ next: { value: 1 }, result: null }));
    // Another tab opens a newer schema version; this connection must not block it.
    const newer = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = factory.open("upgrade-test", 2);
      opening.onsuccess = () => {
        resolve(opening.result);
      };
      opening.onerror = () => {
        reject(opening.error ?? new Error("open failed"));
      };
      opening.onblocked = () => {
        reject(new Error("blocked by the old connection"));
      };
    });
    newer.close();
    await expect(db.get("k")).rejects.toMatchObject({ failure: "closed" });
    await expect(db.update("k", () => ({ next: { value: 2 }, result: null }))).rejects.toMatchObject({ failure: "closed" });
    await expect(db.keys()).rejects.toMatchObject({ failure: "closed" });
  });

  it("reports a browser without IndexedDB as unavailable", async () => {
    // The test setup installs a global factory; take it away for this check.
    const saved = globalThis.indexedDB;
    Reflect.deleteProperty(globalThis, "indexedDB");
    try {
      const error = await openIndexedDb().catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(StorageError);
      expect(error).toMatchObject({ failure: "unavailable" });
    } finally {
      globalThis.indexedDB = saved;
    }
  });

  it("reports a refused open (private mode, blocked site data) as unavailable", async () => {
    const factory = new IDBFactory();
    factory.open = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    await expect(openIndexedDb(factory)).rejects.toMatchObject({ failure: "unavailable" });
  });
});
