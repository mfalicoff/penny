import { saveEntry } from "@domain/commands.ts";
import { describe, expect, it, vi } from "vitest";
import { MemoryLedgerDatabase, StorageError } from "../../src/offline/database";
import { LedgerSaveError } from "../../src/offline/engine";
import { accountScope, recordKey } from "../../src/offline/record";
import { add, ALEX, BOB, channelHub, edit, entry, FakeServer, ledger, openTab, remove, rule, SERVER, settled, titles } from "./harness";

const key = (email = ALEX) => recordKey(accountScope(SERVER, email));

describe("first download and durable saves", () => {
  it("downloads the ledger, stores base and local, and shows it", async () => {
    const server = new FakeServer(ledger({ transactions: [entry("a", "Groceries")] }));
    const db = new MemoryLedgerDatabase();
    const tab = openTab({ server, db });
    await settled(tab);
    expect(tab.engine.getState()).toMatchObject({ phase: "upToDate", pending: { count: 0 }, durable: true });
    expect(titles(tab.engine.getState().ledger)).toEqual(["Groceries"]);
    expect(db.values.get(key())).toMatchObject({ format: 1, server: SERVER, email: ALEX, baseRevision: 1 });
    expect(server.puts).toHaveLength(0);
  });

  it("refuses a save before the first download, and keeps nothing", async () => {
    const server = new FakeServer();
    server.reachable = false;
    const db = new MemoryLedgerDatabase();
    const tab = openTab({ server, db, online: false });
    await settled(tab);
    await expect(tab.engine.save(add(entry("x")))).rejects.toMatchObject({ kind: "notLoaded" });
    expect(db.values.size).toBe(0);
  });

  it("creates, edits and deletes offline, survives a reload and syncs each change once on reconnect", async () => {
    const server = new FakeServer(ledger({ transactions: [entry("a", "Rent"), entry("b", "Coffee")] }));
    const db = new MemoryLedgerDatabase();
    const first = openTab({ server, db });
    await settled(first);

    server.reachable = false;
    first.network.online = false;
    expect(await first.engine.save(add(entry("c", "Bakery")))).toEqual({ savedOffline: true });
    await first.engine.save(edit("a", { title: "Rent (October)" }));
    await first.engine.save(remove("b"));
    await settled(first);
    expect(first.engine.getState()).toMatchObject({ phase: "offline", pending: { count: 3, entryIds: ["a", "c"], deletedEntryIds: ["b"] } });
    expect(first.engine.getState().issue?.kind).toBe("offline");
    first.engine.stop();

    // Reload: a new engine over the same database still has the pending work.
    const second = openTab({ server, db, online: false });
    await settled(second);
    expect(titles(second.engine.getState().ledger)).toEqual(["Bakery", "Rent (October)"]);
    expect(second.engine.getState().pending.count).toBe(3);

    server.reachable = true;
    second.network.online = true;
    await second.engine.syncNow();
    expect(titles(server.ledger)).toEqual(["Bakery", "Rent (October)"]);
    expect(server.puts).toHaveLength(1);
    expect(second.engine.getState()).toMatchObject({ phase: "upToDate", pending: { count: 0 } });
    await second.engine.syncNow();
    expect(server.puts).toHaveLength(1);
  });

  it("says a save waits for the network from the current state, not the last sync's issue", async () => {
    const server = new FakeServer(ledger());
    const tab = openTab({ server });
    await settled(tab);
    server.reachable = false;
    tab.network.online = false;
    expect(await tab.engine.save(add(entry("c", "Bakery")))).toEqual({ savedOffline: true });
    await settled(tab);
    expect(tab.engine.getState().issue?.kind).toBe("offline");

    // Back online, before any sync noticed: the save syncs right away.
    server.reachable = true;
    tab.network.online = true;
    expect(await tab.engine.save(add(entry("d", "Lunch")))).toEqual({ savedOffline: false });
    await settled(tab);
    expect(titles(server.ledger)).toEqual(["Bakery", "Lunch"]);
  });

  it("keeps the ledger unchanged when a rule refuses the change", async () => {
    const server = new FakeServer(ledger({ transactions: [entry("a", "Rent")] }));
    const db = new MemoryLedgerDatabase();
    const tab = openTab({ server, db });
    await settled(tab);
    const writes = db.writes;
    const stale = entry("a", "Rent", { note: "an older copy" });
    await expect(tab.engine.save(saveEntry({ ...stale, title: "Rent!" }, stale))).rejects.toMatchObject({
      kind: "rule",
      message: expect.stringContaining("changed on another device") as unknown,
    });
    expect(db.writes).toBe(writes);
    expect(titles(tab.engine.getState().ledger)).toEqual(["Rent"]);
  });

  it("reports a full disk without changing anything", async () => {
    const server = new FakeServer();
    const db = new MemoryLedgerDatabase();
    const tab = openTab({ server, db });
    await settled(tab);
    db.failWith = new StorageError("quota");
    const error = await tab.engine.save(add(entry("x", "Lunch"))).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(LedgerSaveError);
    expect(error).toMatchObject({ kind: "writeFailed", message: expect.stringContaining("out of storage space") as unknown });
    expect(tab.engine.getState().ledger?.transactions).toEqual([]);
    expect(tab.engine.getState().pending.count).toBe(0);
  });

  it("records due recurring entries once, in the browser's local calendar", async () => {
    const server = new FakeServer(ledger({ recurring: [rule("pass", { nextDate: "2026-11-01" })] }));
    const tab = openTab({ server });
    await settled(tab);
    // The first sync caught the rule up and wrote the occurrence to the server.
    expect(server.ledger.transactions.map((item) => item.id)).toEqual(["pass:2026-11-01"]);
    expect(server.ledger.recurring[0]?.nextDate).toBe("2026-12-01");
    await tab.engine.syncNow();
    expect(server.puts).toHaveLength(1);
  });
});

describe("conflicts with other devices", () => {
  it("merges an iOS edit that lands between read and write, keeping both changes", async () => {
    const server = new FakeServer(ledger({ transactions: [entry("a", "Rent"), entry("b", "Coffee")] }));
    const tab = openTab({ server });
    await settled(tab);
    server.reachable = false;
    tab.network.online = false;
    await tab.engine.save(edit("a", { note: "paid by transfer" }));
    await tab.engine.save(add(entry("c", "Bakery")));

    server.reachable = true;
    tab.network.online = true;
    let raced = false;
    server.beforePut = () => {
      if (raced) return;
      raced = true;
      server.otherDevice(edit("a", { title: "Rent (iOS)" }));
      server.otherDevice(edit("b", { share: 600 }));
    };
    await tab.engine.syncNow();

    const a = server.ledger.transactions.find((item) => item.id === "a");
    expect(a).toMatchObject({ title: "Rent (iOS)", note: "paid by transfer" });
    expect(server.ledger.transactions.find((item) => item.id === "b")?.share).toBe(600);
    expect(server.ledger.transactions.filter((item) => item.id === "c")).toHaveLength(1);
    expect(tab.engine.getState().ledger).toEqual(server.ledger);
    expect(tab.engine.getState().pending.count).toBe(0);
  });

  it("lets this browser win a same-field race, and lets a server-only change through", async () => {
    const server = new FakeServer(ledger({ transactions: [entry("a", "Rent"), entry("b", "Coffee")] }));
    const tab = openTab({ server });
    await settled(tab);
    server.reachable = false;
    await tab.engine.save(edit("a", { title: "Rent (web)" }));
    server.otherDevice(edit("a", { title: "Rent (iOS)" }));
    server.otherDevice(remove("b"));
    server.reachable = true;
    await tab.engine.syncNow();
    expect(server.ledger.transactions).toEqual([entry("a", "Rent (web)")]);
  });

  it("gives up after five 409s, keeps the work, and converges on the next sync", async () => {
    const server = new FakeServer(ledger());
    const tab = openTab({ server });
    await settled(tab);
    server.reachable = false;
    await tab.engine.save(add(entry("c", "Bakery")));
    server.reachable = true;
    server.beforePut = () => {
      server.otherDevice((value) => ({ ...value, currency: value.currency }));
    };
    await tab.engine.syncNow();
    expect(tab.engine.getState().issue).toMatchObject({ kind: "conflictRetriesExhausted", retries: true });
    expect(tab.engine.getState().pending.count).toBe(1);
    server.beforePut = null;
    await tab.engine.syncNow();
    expect(titles(server.ledger)).toEqual(["Bakery"]);
    expect(tab.engine.getState().phase).toBe("upToDate");
  });

  it("merges a save that lands while a sync is in flight and sends it in another pass", async () => {
    const server = new FakeServer(ledger());
    const tab = openTab({ server });
    await settled(tab);
    let release: () => void = () => undefined;
    server.getGate = new Promise((resolve) => {
      release = resolve;
    });
    await tab.engine.save(add(entry("c", "Bakery")));
    // The sync started by the save is waiting on GET; save again meanwhile.
    await tab.engine.save(add(entry("d", "Lunch")));
    server.getGate = null;
    release();
    await settled(tab);
    expect(titles(server.ledger)).toEqual(["Bakery", "Lunch"]);
    expect(tab.engine.getState().pending.count).toBe(0);
  });

  it("schedules a retry when saves keep landing during every pass", async () => {
    const server = new FakeServer(ledger());
    const db = new MemoryLedgerDatabase();
    const tab = openTab({ server, db });
    await settled(tab);
    // Another tab saves while each PUT is in flight, so every pass ends with something pending.
    let landed = 0;
    server.beforePut = () => {
      landed += 1;
      const name = `late-${String(landed)}`;
      void db.update(key(), (raw) => {
        const record = raw as { local: { transactions: object[] } };
        return { next: { ...record, local: { ...record.local, transactions: [...record.local.transactions, entry(name)] } }, result: null };
      });
    };
    server.reachable = false;
    await tab.engine.save(add(entry("c", "Bakery")));
    await settled(tab);
    server.reachable = true;
    await tab.engine.syncNow();
    expect(server.puts).toHaveLength(3);
    expect(tab.engine.getState()).toMatchObject({ phase: "pending", issue: null, pending: { count: 1 } });
    expect(tab.engine.retryScheduled).toBe(true);

    server.beforePut = null;
    await tab.engine.syncNow();
    expect(titles(server.ledger)).toEqual(["Bakery", "late-1", "late-2", "late-3"]);
    expect(tab.engine.getState().phase).toBe("upToDate");
    expect(tab.engine.retryScheduled).toBe(false);
  });

  it("converges without duplicates when storing the server's answer fails", async () => {
    const server = new FakeServer(ledger());
    const db = new MemoryLedgerDatabase();
    const tab = openTab({ server, db });
    await settled(tab);
    server.reachable = false;
    await tab.engine.save(add(entry("c", "Bakery")));
    server.reachable = true;
    // The server accepts the PUT, then the browser can't record the answer.
    server.beforePut = () => {
      db.failWith = new StorageError("failed");
    };
    await tab.engine.syncNow();
    expect(tab.engine.getState().issue?.kind).toBe("storageWriteFailed");
    expect(titles(server.ledger)).toEqual(["Bakery"]);
    server.beforePut = null;
    db.failWith = null;
    await tab.engine.syncNow();
    expect(server.ledger.transactions).toHaveLength(1);
    expect(server.puts).toHaveLength(1);
    expect(tab.engine.getState()).toMatchObject({ phase: "upToDate", pending: { count: 0 } });
  });
});

describe("failures", () => {
  it("maps server failures to issues and keeps pending work", async () => {
    const server = new FakeServer(ledger());
    const tab = openTab({ server });
    await settled(tab);
    server.reachable = false;
    expect(await tab.engine.save(add(entry("c", "Bakery")))).toEqual({ savedOffline: false });
    await settled(tab);
    expect(tab.engine.getState().issue?.kind).toBe("serverUnreachable");
    server.reachable = true;

    server.failures = [503];
    await tab.engine.syncNow();
    expect(tab.engine.getState().issue).toMatchObject({ kind: "serverUnavailable", retries: true });

    server.failures = [400];
    await tab.engine.syncNow();
    expect(tab.engine.getState().issue).toMatchObject({ kind: "rejected", retries: false });
    expect(tab.engine.getState().pending.count).toBe(1);
    await tab.engine.syncNow();
    expect(tab.engine.getState().phase).toBe("upToDate");
  });

  it("never writes over a ledger version it can't read", async () => {
    const server = new FakeServer(ledger());
    const tab = openTab({ server });
    await settled(tab);
    server.reachable = false;
    await tab.engine.save(add(entry("c", "Bakery")));
    server.reachable = true;
    server.otherDevice((value) => ({ ...value, version: 5 as 4 }));
    await tab.engine.syncNow();
    expect(tab.engine.getState().issue).toMatchObject({ kind: "incompatibleServerData", retries: false });
    expect(tab.engine.getState().pending.count).toBe(1);
    expect(server.puts).toHaveLength(0);
  });

  it("treats 401 as an ended session: nothing local changes and the same account resumes", async () => {
    const server = new FakeServer(ledger());
    const db = new MemoryLedgerDatabase();
    const tab = openTab({ server, db });
    await settled(tab);
    server.reachable = false;
    await tab.engine.save(add(entry("c", "Bakery")));
    server.reachable = true;
    server.failures = [401];
    await tab.engine.syncNow();
    expect(tab.engine.getState().phase).toBe("sessionExpired");
    expect(tab.expired).toHaveBeenCalledTimes(1);
    expect(tab.engine.getState().pending.count).toBe(1);
    tab.engine.stop();

    const again = openTab({ server, db });
    await settled(again);
    expect(titles(server.ledger)).toEqual(["Bakery"]);
    expect(again.engine.getState().phase).toBe("upToDate");
  });

  it("drops a late answer after an account switch and never touches another account's copy", async () => {
    const server = new FakeServer(ledger());
    const db = new MemoryLedgerDatabase();
    let release: () => void = () => undefined;
    server.getGate = new Promise((resolve) => {
      release = resolve;
    });
    const alex = openTab({ server, db });
    await vi.waitFor(() => {
      expect(server.gets).toBe(1);
    });
    alex.engine.stop();
    server.getGate = null;
    release();
    const bob = openTab({ server, db, email: BOB });
    await settled(bob);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(db.values.has(key(ALEX))).toBe(false);
    expect(db.values.has(key(BOB))).toBe(true);
    expect(alex.snapshots).toEqual([]);
  });

  it("refuses an unreadable or misplaced copy, then recovers it on request", async () => {
    const server = new FakeServer(ledger({ transactions: [entry("a", "Rent")] }));
    const db = new MemoryLedgerDatabase();
    db.values.set(key(), { format: 1, server: SERVER, email: BOB, baseRevision: 1, base: ledger(), local: ledger(), lastSyncedAt: null, savedAt: "x" });
    const tab = openTab({ server, db });
    await settled(tab);
    expect(tab.engine.getState().phase).toBe("storageUnreadable");
    await expect(tab.engine.save(add(entry("x")))).rejects.toMatchObject({ kind: "storageUnreadable" });
    expect(await tab.engine.pendingCount()).toBe(1);
    expect(server.gets).toBe(0);

    await tab.engine.recoverUnreadableStorage();
    await settled(tab);
    expect(tab.engine.getState().phase).toBe("upToDate");
    expect(titles(tab.engine.getState().ledger)).toEqual(["Rent"]);
    const aside = [...db.values.keys()].filter((name) => name.startsWith("aside\n"));
    expect(aside).toHaveLength(1);
    expect(await tab.engine.pendingCount()).toBe(0);
  });

  it("leaves a copy from a newer version untouched", async () => {
    const server = new FakeServer(ledger());
    const db = new MemoryLedgerDatabase();
    const future = { format: 2, server: SERVER, email: ALEX, whatever: true };
    db.values.set(key(), future);
    const tab = openTab({ server, db });
    await settled(tab);
    expect(tab.engine.getState().phase).toBe("storageNewerFormat");
    await expect(tab.engine.save(add(entry("x")))).rejects.toMatchObject({ kind: "storageNewerFormat" });
    await tab.engine.recoverUnreadableStorage();
    expect(db.values.get(key())).toEqual(future);
  });

  it("asks for a reload, without retrying, once another tab's upgrade closed the connection", async () => {
    const server = new FakeServer(ledger());
    const db = new MemoryLedgerDatabase();
    const tab = openTab({ server, db });
    await settled(tab);
    // What `openIndexedDb` reports after `versionchange` closed this tab's connection.
    db.failReads = new StorageError("closed");
    const gets = server.gets;
    await tab.engine.syncNow();
    expect(tab.engine.getState()).toMatchObject({ phase: "storageNewerFormat", issue: null });
    expect(tab.engine.retryScheduled).toBe(false);
    await expect(tab.engine.save(add(entry("x")))).rejects.toMatchObject({ kind: "storageNewerFormat" });
    await tab.engine.syncNow();
    expect(server.gets).toBe(gets);
  });

  it("refuses a save with the reload message when the connection closed before any sync noticed", async () => {
    const server = new FakeServer(ledger());
    const db = new MemoryLedgerDatabase();
    const tab = openTab({ server, db });
    await settled(tab);
    db.failReads = new StorageError("closed");
    await expect(tab.engine.save(add(entry("x")))).rejects.toMatchObject({ kind: "storageNewerFormat" });
    expect(tab.engine.getState().phase).toBe("storageNewerFormat");
  });

  it("shows the ledger but refuses saves when the browser blocks storage", async () => {
    const server = new FakeServer(ledger({ transactions: [entry("a", "Rent")] }));
    const tab = openTab({ server, db: null });
    await vi.waitFor(() => {
      expect(tab.engine.getState().ledger).not.toBeNull();
    });
    expect(tab.engine.getState()).toMatchObject({ phase: "storageUnavailable", durable: false });
    await expect(tab.engine.save(add(entry("x")))).rejects.toMatchObject({ kind: "storageUnavailable" });
    expect(server.puts).toHaveLength(0);
  });
});

describe("several tabs", () => {
  it("shows one tab's offline save in the other and syncs it exactly once", async () => {
    const server = new FakeServer(ledger());
    const db = new MemoryLedgerDatabase();
    const hub = channelHub();
    const one = openTab({ server, db, hub });
    const two = openTab({ server, db, hub });
    await settled(one);
    await settled(two);

    server.reachable = false;
    await one.engine.save(add(entry("c", "Bakery")));
    await vi.waitFor(() => {
      expect(two.engine.getState().pending.count).toBe(1);
    });
    expect(titles(two.engine.getState().ledger)).toEqual(["Bakery"]);

    server.reachable = true;
    await Promise.all([one.engine.syncNow(), two.engine.syncNow(), one.engine.syncNow()]);
    await settled(one);
    await settled(two);
    expect(server.ledger.transactions.filter((item) => item.id === "c")).toHaveLength(1);
    expect(one.engine.getState().ledger).toEqual(server.ledger);
    expect(two.engine.getState().ledger).toEqual(server.ledger);
  });

  it("keeps both tabs' saves when they race, offline and while syncing", async () => {
    const server = new FakeServer(ledger());
    const db = new MemoryLedgerDatabase();
    const hub = channelHub();
    const one = openTab({ server, db, hub });
    const two = openTab({ server, db, hub });
    await settled(one);
    await settled(two);
    server.reachable = false;
    await Promise.all([
      one.engine.save(add(entry("c", "Bakery"))),
      two.engine.save(add(entry("d", "Lunch"))),
      one.engine.save(add(entry("e", "Taxi"))),
    ]);
    server.reachable = true;
    await Promise.all([one.engine.syncNow(), two.engine.save(add(entry("f", "Books"))), two.engine.syncNow()]);
    await settled(one);
    await settled(two);
    expect(titles(server.ledger)).toEqual(["Bakery", "Books", "Lunch", "Taxi"]);
    expect(one.engine.getState().pending.count).toBe(0);
    expect(two.engine.getState().ledger).toEqual(server.ledger);
  });

  it("never records the same recurring occurrence twice across tabs and devices", async () => {
    const server = new FakeServer(ledger({ recurring: [rule("pass", { nextDate: "2026-11-01" })] }));
    const db = new MemoryLedgerDatabase();
    const hub = channelHub();
    server.reachable = false;
    const one = openTab({ server, db, hub });
    const two = openTab({ server, db: new MemoryLedgerDatabase(), hub });
    server.reachable = true;
    await Promise.all([settled(one), settled(two)]);
    expect(server.ledger.transactions.map((item) => item.id)).toEqual(["pass:2026-11-01"]);
  });
});

describe("sign-out", () => {
  it("counts pending work, removes the copy only when nothing is pending, and never strands a late save", async () => {
    const server = new FakeServer(ledger());
    const db = new MemoryLedgerDatabase();
    const hub = channelHub();
    const one = openTab({ server, db, hub });
    const two = openTab({ server, db, hub });
    await settled(one);
    await settled(two);

    server.reachable = false;
    await one.engine.save(add(entry("c", "Bakery")));
    expect(await two.engine.beginSignOut()).toBe(1);
    two.engine.cancelSignOut();
    server.reachable = true;
    await one.engine.syncNow();

    expect(await one.engine.beginSignOut()).toBe(0);
    await expect(one.engine.save(add(entry("x")))).rejects.toMatchObject({ kind: "unavailable" });
    // Another tab saves after the count and before the removal.
    server.reachable = false;
    await two.engine.save(add(entry("d", "Lunch")));
    await one.engine.finishSignOut();
    expect(db.values.has(key())).toBe(true);

    server.reachable = true;
    await two.engine.syncNow();
    expect(await two.engine.beginSignOut()).toBe(0);
    await two.engine.finishSignOut();
    expect(db.values.has(key())).toBe(false);
  });

  it("puts back the retry it parked when sign-out is cancelled", async () => {
    const server = new FakeServer(ledger());
    const tab = openTab({ server });
    await settled(tab);
    server.failures = [503];
    await tab.engine.syncNow();
    expect(tab.engine.getState().issue?.kind).toBe("serverUnavailable");
    expect(tab.engine.retryScheduled).toBe(true);

    expect(await tab.engine.beginSignOut()).toBe(0);
    expect(tab.engine.retryScheduled).toBe(false);
    tab.engine.cancelSignOut();
    expect(tab.engine.retryScheduled).toBe(true);
  });

  it("removes the records set aside for the account, and only that account's", async () => {
    const server = new FakeServer(ledger());
    const db = new MemoryLedgerDatabase();
    const mine = `aside\n${SERVER}\n${ALEX}\n2026-11-01T00:00:00.000Z`;
    const theirs = `aside\n${SERVER}\n${BOB}\n2026-11-01T00:00:00.000Z`;
    db.values.set(mine, { damaged: true });
    db.values.set(theirs, { damaged: true });
    const tab = openTab({ server, db });
    await settled(tab);
    expect(await tab.engine.beginSignOut()).toBe(0);
    await tab.engine.finishSignOut();
    expect(db.values.has(mine)).toBe(false);
    expect(db.values.has(theirs)).toBe(true);
  });
});
