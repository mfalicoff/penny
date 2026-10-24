import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createApp, type AppOptions } from "../server/app.ts";
import { createAuthService, SESSION_DURATION_MS } from "../server/application/auth.ts";
import { createRepositories } from "../server/infrastructure/repositories.ts";
import { openDatabase } from "../server/infrastructure/database.ts";
import { security } from "../server/infrastructure/security.ts";
import { emptyLedger } from "../src/domain/ledger.ts";

async function start(options: Partial<AppOptions> = {}) {
  const { app, db } = createApp({ databasePath: ":memory:", ...options });
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
  } catch (error) {
    db.close();
    throw error;
  }
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  return {
    db,
    request(path: string, options?: RequestInit) { return fetch(base + path, options); },
    async close() {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      db.close();
    },
  };
}
const credentials = { email: "person@example.test", password: "a secure test password" };
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("HTTP adapter preserves cookies, bearer precedence, API errors and security headers", async (t) => {
  const api = await start({ secureCookies: true });
  t.after(() => api.close());
  const info = await api.request("/info");
  assert.equal(info.status, 200);
  assert.deepEqual(await info.json(), {
    name: "penny",
    version: JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version,
  });
  assert.equal(info.headers.get("cache-control"), "no-store");
  const health = await api.request("/health");
  assert.deepEqual(await health.json(), { ok: true });
  assert.equal(health.headers.get("cache-control"), "no-store");
  assert.equal(health.headers.get("x-content-type-options"), "nosniff");
  assert.equal(health.headers.get("x-powered-by"), null);
  const registration = await api.request("/auth/register", post(credentials));
  assert.equal(registration.status, 201);
  const cookieHeader = registration.headers.get("set-cookie")!;
  for (const flag of [/HttpOnly/, /Secure/, /SameSite=Lax/, /Path=\/api/, /Max-Age=2592000/]) assert.match(cookieHeader, flag);
  const cookie = cookieHeader.split(";")[0];
  const { token } = await registration.json();
  const me = await api.request("/auth/me", { headers: { Cookie: cookie } });
  assert.deepEqual(await me.json(), { email: credentials.email });
  assert.equal((await api.request("/auth/me", { headers: { Cookie: cookie, Authorization: `Bearer ${"0".repeat(64)}` } })).status, 401);
  const missing = await api.request("/missing", { headers: { Cookie: cookie } });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "API route not found." });
  const malformed = await api.request("/ledger", { method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "Invalid JSON." });
  const tooLarge = await api.request("/ledger", { method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify("x".repeat(20 * 1024 * 1024)) });
  assert.equal(tooLarge.status, 413);
  assert.deepEqual(await tooLarge.json(), { error: "The upload is too large." });
  const preflight = await api.request("/ledger", { method: "OPTIONS", headers: { Origin: "http://localhost:8081", "Access-Control-Request-Method": "PUT" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:8081");
  assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");
  const logout = await api.request("/auth/logout", { method: "POST", headers: { Cookie: cookie } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie")!, /penny_session=;/);
  assert.equal((await api.request("/auth/me", { headers: { Authorization: `Bearer ${token}` } })).status, 401);
});

test("registration policy and rate limiter remain per-app and public auth routes stay reachable", async (t) => {
  const api = await start({ allowRegistration: false });
  t.after(() => api.close());
  const disabled = await api.request("/auth/register", post(credentials));
  assert.equal(disabled.status, 403);
  assert.deepEqual(await disabled.json(), { error: "Account registration is disabled on this server." });
  for (let i = 0; i < 39; i++) {
    assert.equal((await api.request("/auth/login", post({}))).status, 401);
  }
  const limited = await api.request("/auth/login", post({}));
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), { error: "Too many attempts. Please try again in 15 minutes." });
  assert.equal((await api.request("/health")).status, 200);
  const other = await start();
  t.after(() => other.close());
  assert.equal((await other.request("/auth/login", post({}))).status, 401);
});

test("simultaneous registrations create one account and return a conflict for the loser", async (t) => {
  const api = await start();
  t.after(() => api.close());
  const responses = await Promise.all([
    api.request("/auth/register", post(credentials)),
    api.request("/auth/register", post({ ...credentials, email: " PERSON@EXAMPLE.TEST " })),
  ]);
  assert.deepEqual(responses.map((res) => res.status).sort(), [201, 409]);
  assert.deepEqual(await responses.find((res) => res.status === 409)!.json(), { error: "An account with this email already exists. Please sign in." });
  assert.equal(api.db.prepare("SELECT COUNT(*) AS count FROM users").get()!.count, 1);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS count FROM ledgers").get()!.count, 1);
  assert.equal((await api.request("/auth/login", post(credentials))).status, 200);
});

test("auth service expires sessions at the boundary without HTTP and stores only token hashes", async (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  let now = 1000;
  const auth = createAuthService({ ...createRepositories(db), security, allowRegistration: true, now: () => now });
  const { token } = await auth.register(credentials);
  const session = auth.authenticate(token);
  assert.equal(session.tokenHash, security.hashToken(token));
  const stored = db.prepare("SELECT token_hash, expires FROM sessions").get()!;
  assert.notEqual(stored.token_hash, token);
  assert.equal(stored.expires, 1000 + SESSION_DURATION_MS);
  now += SESSION_DURATION_MS - 1;
  assert.equal(auth.authenticate(token).userId, session.userId);
  now++;
  assert.throws(() => auth.authenticate(token), { reason: "unauthorized" });
});

test("account repository rolls back user creation if the initial ledger cannot be saved", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const repositories = createRepositories(db);
  db.exec("CREATE TRIGGER fail_ledger BEFORE INSERT ON ledgers BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
  const user = { id: "test", email: credentials.email, password: "hash", salt: "salt" };
  assert.throws(() => repositories.accounts.create(user, emptyLedger()), /test failure/);
  assert.equal(repositories.accounts.findByEmail(user.email), undefined);
  db.exec("DROP TRIGGER fail_ledger");
  assert.equal(repositories.accounts.create(user, emptyLedger()), true);
  assert.deepEqual(repositories.ledgers.read(user.id), { revision: 0, ledger: emptyLedger() });
});
