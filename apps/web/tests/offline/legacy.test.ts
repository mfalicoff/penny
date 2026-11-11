import { describe, expect, it } from "vitest";
import { MemoryLedgerDatabase, StorageError } from "../../src/offline/database";
import { fingerprint, legacyLedgerKey, readLegacyCopy } from "../../src/offline/legacy";
import { accountScope, recordKey } from "../../src/offline/record";
import { ALEX, BOB, channelHub, entry, FakeServer, ledger, MemoryStorage, openTab, SERVER, settled, titles } from "./harness";

const key = recordKey(accountScope(SERVER, ALEX));

/** What the legacy Expo web app left in localStorage: `{base, local}` v4, no revision. */
function legacyStorage(email = ALEX, extra: { base?: object; local?: object } = {}) {
  const storage = new MemoryStorage();
  const base = ledger({ transactions: [entry("a", "Rent")] });
  const local = ledger({ transactions: [entry("a", "Rent (edited offline)"), entry("b", "Coffee")] });
  storage.setItem(legacyLedgerKey(email), JSON.stringify({ base: extra.base ?? base, local: extra.local ?? local }));
  storage.setItem("penny:active-account", email);
  return storage;
}

describe("legacy Expo web import", () => {
  it("imports unsynced edits, syncs them, and only then removes the original", async () => {
    const server = new FakeServer(ledger({ transactions: [entry("a", "Rent"), entry("z", "Made on iOS")] }));
    const legacy = legacyStorage();
    const db = new MemoryLedgerDatabase();
    const tab = openTab({ server, db, legacy });
    await settled(tab);

    expect(titles(server.ledger)).toEqual(["Coffee", "Made on iOS", "Rent (edited offline)"]);
    expect(server.puts).toHaveLength(1);
    expect(legacy.getItem(legacyLedgerKey(ALEX))).toBeNull();
    // The active-account hint is harmless and left alone.
    expect(legacy.getItem("penny:active-account")).toBe(ALEX);
    expect(db.values.get(key)).toMatchObject({ legacy: { removedAt: expect.any(String) as unknown } });
    expect(tab.engine.getState()).toMatchObject({ phase: "upToDate", pending: { count: 0 } });
  });

  it("keeps the original until a sync succeeds, survives an interrupted run, and imports once", async () => {
    const server = new FakeServer(ledger({ transactions: [entry("a", "Rent")] }));
    server.reachable = false;
    const legacy = legacyStorage();
    const original = legacy.getItem(legacyLedgerKey(ALEX));
    const db = new MemoryLedgerDatabase();
    const first = openTab({ server, db, legacy, online: false });
    await settled(first);
    expect(first.engine.getState().pending.count).toBe(2);
    expect(db.values.get(key)).toMatchObject({ baseRevision: null, legacy: { fingerprint: fingerprint(original ?? "") } });
    expect(legacy.getItem(legacyLedgerKey(ALEX))).toBe(original);
    first.engine.stop();

    // Reload, still offline: the copy is recognized, not imported again.
    const writes = db.writes;
    const second = openTab({ server, db, legacy, online: false });
    await settled(second);
    expect(db.writes).toBe(writes);
    expect(second.engine.getState().pending.count).toBe(2);
    expect(await second.engine.pendingCount()).toBe(2);

    server.reachable = true;
    second.network.online = true;
    await second.engine.syncNow();
    expect(titles(server.ledger)).toEqual(["Coffee", "Rent (edited offline)"]);
    expect(legacy.getItem(legacyLedgerKey(ALEX))).toBeNull();
  });

  it("imports exactly once when two tabs start together", async () => {
    const server = new FakeServer(ledger({ transactions: [entry("a", "Rent")] }));
    const legacy = legacyStorage();
    const db = new MemoryLedgerDatabase();
    const hub = channelHub();
    const one = openTab({ server, db, legacy, hub });
    const two = openTab({ server, db, legacy, hub });
    await Promise.all([settled(one), settled(two)]);
    expect(server.ledger.transactions.filter((item) => item.id === "b")).toHaveLength(1);
    expect(titles(server.ledger)).toEqual(["Coffee", "Rent (edited offline)"]);
    expect(legacy.getItem(legacyLedgerKey(ALEX))).toBeNull();
  });

  it("merges a legacy copy that changed after the import (the old app ran again) instead of dropping it", async () => {
    const server = new FakeServer(ledger({ transactions: [entry("a", "Rent")] }));
    server.reachable = false;
    const legacy = legacyStorage();
    const db = new MemoryLedgerDatabase();
    const first = openTab({ server, db, legacy, online: false });
    await settled(first);
    first.engine.stop();

    const base = ledger({ transactions: [entry("a", "Rent")] });
    legacy.setItem(legacyLedgerKey(ALEX), JSON.stringify({ base, local: ledger({ transactions: [entry("a", "Rent"), entry("c", "Bakery")] }) }));
    server.reachable = true;
    const second = openTab({ server, db, legacy });
    await settled(second);
    expect(titles(server.ledger)).toEqual(["Bakery", "Coffee", "Rent (edited offline)"]);
    expect(legacy.getItem(legacyLedgerKey(ALEX))).toBeNull();
  });

  it("keeps an unreadable copy, counts it for sign-out, and sets it aside on request", async () => {
    const server = new FakeServer(ledger());
    const legacy = new MemoryStorage();
    legacy.setItem(legacyLedgerKey(ALEX), "{not json");
    const tab = openTab({ server, legacy });
    await settled(tab);
    expect(tab.engine.getState().legacyUnreadable).toBe(true);
    expect(tab.engine.getState().phase).toBe("upToDate");
    expect(legacy.getItem(legacyLedgerKey(ALEX))).toBe("{not json");
    expect(await tab.engine.pendingCount()).toBe(1);

    tab.engine.setLegacyCopyAside();
    expect(tab.engine.getState().legacyUnreadable).toBe(false);
    expect(legacy.getItem(legacyLedgerKey(ALEX))).toBeNull();
    expect([...legacy.items.entries()].find(([name]) => name.includes(".unreadable-"))?.[1]).toBe("{not json");
    expect(await tab.engine.pendingCount()).toBe(0);
  });

  it("refuses to set an unreadable copy aside when storage is full, and changes nothing", async () => {
    const server = new FakeServer(ledger());
    const legacy = new MemoryStorage();
    legacy.setItem(legacyLedgerKey(ALEX), "{not json");
    const tab = openTab({ server, legacy });
    await settled(tab);
    legacy.failWrites = true;
    expect(() => {
      tab.engine.setLegacyCopyAside();
    }).toThrow();
    expect(legacy.getItem(legacyLedgerKey(ALEX))).toBe("{not json");
    expect(tab.engine.getState().legacyUnreadable).toBe(true);
  });

  it("leaves the original in place when the import can't be stored, and still counts its edits", async () => {
    const server = new FakeServer(ledger({ transactions: [entry("a", "Rent")] }));
    server.reachable = false;
    const legacy = legacyStorage();
    const original = legacy.getItem(legacyLedgerKey(ALEX));
    const db = new MemoryLedgerDatabase();
    db.failWith = new StorageError("quota");
    const tab = openTab({ server, db, legacy, online: false });
    await settled(tab);
    expect(legacy.getItem(legacyLedgerKey(ALEX))).toBe(original);
    expect(db.values.size).toBe(0);
    expect(await tab.engine.pendingCount()).toBe(2);
  });

  it("uploads the legacy edits even when the browser blocks IndexedDB, then removes the original", async () => {
    const server = new FakeServer(ledger({ transactions: [entry("a", "Rent")] }));
    const legacy = legacyStorage();
    const tab = openTab({ server, db: null, legacy });
    await settled(tab);
    expect(tab.engine.getState()).toMatchObject({ phase: "storageUnavailable", durable: false });
    expect(titles(server.ledger)).toEqual(["Coffee", "Rent (edited offline)"]);
    expect(legacy.getItem(legacyLedgerKey(ALEX))).toBeNull();
  });

  it("only imports the signed-in account's copy", async () => {
    const server = new FakeServer(ledger());
    const legacy = legacyStorage(BOB);
    const db = new MemoryLedgerDatabase();
    const tab = openTab({ server, db, legacy });
    await settled(tab);
    expect(titles(server.ledger)).toEqual([]);
    expect(legacy.getItem(legacyLedgerKey(BOB))).not.toBeNull();
    expect(readLegacyCopy(legacy, BOB).kind).toBe("readable");
  });

  it("reads v1–v3 legacy ledgers by upgrading them", () => {
    const storage = new MemoryStorage();
    const old = { version: 2, currency: "CAD", categories: [], transactions: [], recurring: [] };
    storage.setItem(legacyLedgerKey(ALEX), JSON.stringify({ base: old, local: old }));
    const copy = readLegacyCopy(storage, ALEX);
    expect(copy.kind).toBe("readable");
    if (copy.kind === "readable") expect(copy.local).toMatchObject({ version: 4, accounts: [], trips: [] });
  });
});
