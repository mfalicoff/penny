import { test } from "node:test";
import assert from "node:assert/strict";
import { createPushService, retryAt, type PushRepository, type PushReceiptCandidate } from "../../server/application/push.ts";
import { createPushRepository } from "../../server/infrastructure/push.ts";
import { openDatabase } from "../../server/infrastructure/database.ts";
import { once } from "node:events";
import { createApp } from "../../server/app.ts";

const session = { userId: "user-one", tokenHash: "session-one" };
const token = "ExponentPushToken[device_one]";
const payload = JSON.stringify({ householdId: "home", month: "2026-09", expenseId: "expense-1", eventId: "event-1" });

function memoryRepository(): PushRepository & { accepted: string[]; retries: number[]; removed: string[] } {
  const accepted: string[] = [];
  const retries: number[] = [];
  const removed: string[] = [];
  return {
    accepted, retries, removed,
    registerDevice() {}, removeDevice() {},
    claimDue: () => [{ outboxId: "out-1", token, eventType: "expense.created", payload, attempts: 1 }],
    markAccepted: (_item, ticketId) => { accepted.push(ticketId); },
    markRetry: (_item, next) => { retries.push(next); },
    markPermanent() {},
    removeInvalidToken: (value) => { removed.push(value); },
    claimReceipts: () => [], markReceiptChecked() {}, retryReceipt() {},
  };
}

test("push service validates session-scoped device registration", () => {
  const calls: unknown[] = [];
  const repository = memoryRepository();
  repository.registerDevice = (...args) => { calls.push(args); };
  repository.removeDevice = (...args) => { calls.push(args); };
  const push = createPushService(repository, async () => { throw new Error("Network must not be used"); }, () => 1234);
  assert.deepEqual(push.register(session, { token, platform: "ios" }), { ok: true });
  assert.deepEqual(push.remove(session, { token }), { ok: true });
  assert.deepEqual(calls, [[session, token, "ios", 1234], [session, token, 1234]]);
  assert.throws(() => push.register(session, { token: "not-a-token", platform: "ios" }));
});

test("flush sends the household payload once and records the Expo ticket", async () => {
  const repository = memoryRepository();
  const requests: { url: string; body: unknown }[] = [];
  const http: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return Response.json({ data: [{ status: "ok", id: "ticket-1" }] });
  };
  const push = createPushService(repository, http, () => 1000);
  assert.equal(await push.flushDue(), 1);
  assert.deepEqual(repository.accepted, ["ticket-1"]);
  assert.equal(requests[0].url, "https://exp.host/--/api/v2/push/send");
  assert.deepEqual((requests[0].body as { channelId: string; data: unknown }[])[0].data, JSON.parse(payload));
  assert.equal((requests[0].body as { channelId: string }[])[0].channelId, "households");
});

test("temporary failures back off; DeviceNotRegistered removes the token", async () => {
  const repository = memoryRepository();
  let fails = true;
  const push = createPushService(repository, async () => {
    if (fails) throw new Error("offline");
    return Response.json({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] });
  }, () => 1000);
  assert.equal(await push.flushDue(), 0);
  assert.deepEqual(repository.retries, [6000]);
  assert.equal(retryAt(1000, 4), 41000);
  fails = false;
  assert.equal(await push.flushDue(), 0);
  assert.deepEqual(repository.removed, [token]);
});

test("receipts remove a device rejected after Expo accepted its ticket", async () => {
  const repository = memoryRepository();
  const candidate: PushReceiptCandidate = { outboxId: "out-1", token, ticketId: "ticket-1", sentAt: 0, attempts: 1 };
  repository.claimReceipts = () => [candidate];
  const checked: string[] = [];
  repository.markReceiptChecked = (item) => { checked.push(item.ticketId); };
  const http: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://exp.host/--/api/v2/push/getReceipts");
    assert.deepEqual(JSON.parse(String(init?.body)), { ids: ["ticket-1"] });
    return Response.json({ data: { "ticket-1": { status: "error", details: { error: "DeviceNotRegistered" } } } });
  };
  const push = createPushService(repository, http, () => 1_000_000);
  assert.equal(await push.checkReceipts(), 1);
  assert.deepEqual(repository.removed, [token]);
  assert.deepEqual(checked, ["ticket-1"]);
});

test("receipt rate errors retry, while permanent send errors stop", async () => {
  const repository = memoryRepository();
  const candidate: PushReceiptCandidate = { outboxId: "out-1", token, ticketId: "ticket-1", sentAt: 0, attempts: 2 };
  repository.claimReceipts = () => [candidate];
  const receiptRetries: number[] = [];
  repository.retryReceipt = (_item, nextAt) => { receiptRetries.push(nextAt); };
  const push = createPushService(repository, async () => Response.json({
    data: { "ticket-1": { status: "error", details: { error: "MessageRateExceeded" } } },
  }), () => 1_000_000);
  assert.equal(await push.checkReceipts(), 0);
  assert.deepEqual(receiptRetries, [1_010_000]);

  const terminal: string[] = [];
  repository.markPermanent = (_item, _now, reason) => { terminal.push(reason); };
  const rejected = createPushService(repository, async () => new Response("bad request", { status: 400 }), () => 1_000_000);
  assert.equal(await rejected.flushDue(), 0);
  assert.equal(terminal.length, 1);
  assert.deepEqual(repository.retries, []);
});

test("SQLite adapter leases due deliveries and limits removal to the owner session", () => {
  const db = openDatabase(":memory:");
  try {
    db.prepare("INSERT INTO users VALUES (?,?,?,?)").run("user-one", "one@example.test", "password", "salt");
    db.prepare("INSERT INTO users VALUES (?,?,?,?)").run("user-two", "two@example.test", "password", "salt");
    db.prepare("INSERT INTO sessions VALUES (?,?,?)").run("session-one", "user-one", 10_000_000);
    db.prepare("INSERT INTO sessions VALUES (?,?,?)").run("session-two", "user-two", 10_000_000);
    db.prepare("INSERT INTO households VALUES (?,?,?,?,?,?)").run("home", "Home", "CAD", "user-one", 0, null);
    db.prepare("INSERT INTO push_outbox (id,user_id,household_id,event_type,entity_id,payload,created_at,next_attempt_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("out-1", "user-one", "home", "expense.created", "expense-1", payload, 1, 1);
    const repository = createPushRepository(db);
    repository.registerDevice(session, token, "ios", 10);
    const claimed = repository.claimDue(100, 10);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].token, token);
    assert.deepEqual(repository.claimDue(101, 10), [], "claim lease prevents an immediate duplicate");
    assert.deepEqual(createPushRepository(db).claimDue(101, 10), [], "a second worker respects the same lease");
    repository.removeDevice({ userId: "user-two", tokenHash: "session-two" }, token, 102);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM push_devices").get() as { count: number }).count, 1);
    repository.markAccepted(claimed[0], "ticket-1", 103);
    assert.equal((db.prepare("SELECT sent_at FROM push_outbox WHERE id='out-1'").get() as { sent_at: number }).sent_at, 103);
    assert.deepEqual(repository.claimDue(200_000, 10), [], "Expo-accepted deliveries are not resent");
    assert.deepEqual(repository.claimReceipts(103 + 15 * 60_000, 10).map((item) => item.ticketId), ["ticket-1"]);
    repository.removeDevice(session, token, 104);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM push_devices").get() as { count: number }).count, 0);
  } finally { db.close(); }
});

test("push device routes require a session and logout removes its device", async (t) => {
  const instance = createApp({ databasePath: ":memory:" });
  const server = instance.app.listen(0, "127.0.0.1");
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); instance.db.close(); });
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api`;
  const register = await fetch(`${base}/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "push@example.test", password: "a secure test password" }),
  });
  const session = await register.json() as { token: string };
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` };
  const body = JSON.stringify({ token, platform: "ios" });
  assert.equal((await fetch(`${base}/push/devices`, { method: "POST", headers: { "Content-Type": "application/json" }, body })).status, 401);
  assert.equal((await fetch(`${base}/push/devices`, { method: "POST", headers, body })).status, 201);
  assert.equal((instance.db.prepare("SELECT COUNT(*) AS count FROM push_devices").get() as { count: number }).count, 1);
  assert.equal((await fetch(`${base}/auth/logout`, { method: "POST", headers })).status, 200);
  assert.equal((instance.db.prepare("SELECT COUNT(*) AS count FROM push_devices").get() as { count: number }).count, 0);
});
