import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createApp } from "../../server/app.ts";
import { createAuthService } from "../../server/application/auth.ts";
import { createOidcService } from "../../server/application/oidc.ts";
import { createRepositories } from "../../server/infrastructure/repositories.ts";
import { openDatabase } from "../../server/infrastructure/database.ts";
import { security } from "../../server/infrastructure/security.ts";
import { oidcFromEnv } from "../../server/infrastructure/oidc.ts";

const issuer = "https://identity.example.test";
const redirectUri = "penny://auth/callback";
const options = { issuer, clientId: "penny", redirectUris: [redirectUri], allowRegistration: true };
const identity = { issuer, subject: "person-1", email: "person@example.test" };
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("OIDC HTTP flow validates signed tokens, PKCE and callback binding; sessions work with cookies and bearer tokens", async (t) => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...keys.publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256", use: "sig" };
  const realFetch = globalThis.fetch;
  const codes = new Map<string, { nonce: string; challenge: string; claims?: Record<string, unknown>; badSignature?: boolean }>();
  let exchanged = 0;
  let userInfoSubject = identity.subject;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(issuer)) return realFetch(input, init);
    if (url.endsWith("/.well-known/openid-configuration")) return Response.json({
      issuer, userinfo_endpoint: `${issuer}/userinfo`, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
      response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"],
    });
    if (url.endsWith("/userinfo")) return Response.json({ sub: userInfoSubject, email: identity.email, email_verified: true });
    if (url.endsWith("/jwks")) return Response.json({ keys: [jwk] });
    if (url.endsWith("/token")) {
      exchanged++;
      const body = new URLSearchParams(init?.body as string);
      const code = codes.get(body.get("code")!);
      assert.ok(code);
      assert.equal(body.get("redirect_uri"), redirectUri);
      assert.equal(body.get("client_id"), "penny");
      assert.equal(createHash("sha256").update(body.get("code_verifier")!).digest("base64url"), code.challenge);
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const now = Math.floor(Date.now() / 1000);
      const payload = `${encode({ alg: "RS256", kid: "test" })}.${encode({ iss: issuer, sub: identity.subject, aud: "penny", iat: now, exp: now + 300, nonce: code.nonce, email: identity.email, email_verified: true, ...code.claims })}`;
      const signature = sign("RSA-SHA256", Buffer.from(payload), keys.privateKey);
      if (code.badSignature) signature[0] ^= 255;
      return Response.json({ token_type: "Bearer", access_token: "provider-token", id_token: `${payload}.${signature.toString("base64url")}` });
    }
    throw new Error(`Unexpected provider endpoint: ${url}`);
  });
  const { app, db } = createApp({ databasePath: ":memory:", oidc: options, secureCookies: true });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const request = (path: string, init?: RequestInit) => realFetch(base + path, init);
  assert.deepEqual(await (await request("/auth/oidc")).json(), { enabled: true, label: "Single sign-on" });
  assert.equal((await request("/auth/oidc/start", post({ redirectUri: "https://evil.test" }))).status, 400);
  assert.equal((await request("/auth/oidc/start", { ...post({ redirectUri }), headers: { "Content-Type": "application/json", Origin: "https://evil.test" } })).status, 403);
  async function begin(claims?: Record<string, unknown>, badSignature = false) {
    const response = await request("/auth/oidc/start", post({ redirectUri }));
    assert.equal(response.status, 200);
    const attempt = await response.json();
    const url = new URL(attempt.authorizationUrl);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("scope"), "openid email profile");
    assert.ok(!attempt.authorizationUrl.includes(attempt.transaction));
    const code = security.randomId(16);
    codes.set(code, { nonce: url.searchParams.get("nonce")!, challenge: url.searchParams.get("code_challenge")!, claims, badSignature });
    return { transaction: attempt.transaction, callbackUrl: `${redirectUri}?code=${code}&state=${url.searchParams.get("state")}` };
  }
  const attempt = await begin();
  const completed = await request("/auth/oidc/complete", post(attempt));
  assert.equal(completed.status, 200);
  const cookie = completed.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  const session = await completed.json();
  assert.equal(session.email, identity.email);
  assert.match(session.token, /^[a-f0-9]{64}$/);
  assert.equal((await request("/auth/me", { headers: { Cookie: cookie.split(";")[0] } })).status, 200);
  assert.equal((await request("/ledger", { headers: { Authorization: `Bearer ${session.token}` } })).status, 200);
  assert.equal((await request("/auth/oidc/complete", post(attempt))).status, 401);
  assert.equal(exchanged, 1);
  for (const [claims, badSignature] of [
    [{ nonce: "wrong" }, false], [{ aud: "other-client" }, false], [{ iss: "https://evil.test" }, false],
    [{ exp: 1 }, false], [{ email_verified: false }, false], [{}, true],
  ] as [Record<string, unknown>, boolean][]) {
    assert.equal((await request("/auth/oidc/complete", post(await begin(claims, badSignature)))).status, 401);
  }
  const wrongState = await begin();
  wrongState.callbackUrl = wrongState.callbackUrl.replace(/state=.*/, "state=wrong");
  assert.equal((await request("/auth/oidc/complete", post(wrongState))).status, 401);
  const wrongRedirect = await begin();
  wrongRedirect.callbackUrl = wrongRedirect.callbackUrl.replace(redirectUri, "https://evil.test");
  assert.equal((await request("/auth/oidc/complete", post(wrongRedirect))).status, 401);
  const userInfoLogin = await request("/auth/oidc/complete", post(await begin({ email: undefined, email_verified: undefined })));
  assert.equal(userInfoLogin.status, 200);
  userInfoSubject = "wrong-subject";
  assert.equal((await request("/auth/oidc/complete", post(await begin({ email: undefined, email_verified: undefined })))).status, 401);
  const anotherLogin = await request("/auth/oidc/complete", post(await begin({ email: "changed@example.test" })));
  assert.equal(anotherLogin.status, 200);
  assert.equal((await anotherLogin.json()).email, identity.email);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users").get()!.count, 1);
  assert.equal((await request("/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${session.token}` } })).status, 200);
  assert.equal((await request("/auth/me", { headers: { Authorization: `Bearer ${session.token}` } })).status, 401);
});

test("OIDC transactions expire, require an app-held secret, and cannot be redeemed concurrently", async (t) => {
  const db = openDatabase(":memory:"); t.after(() => db.close());
  const auth = createAuthService({ ...createRepositories(db), security, allowRegistration: true });
  let now = 100;
  let state = "";
  let exchanges = 0;
  const oidc = createOidcService(options, {
    async authorize(_redirect, value) { state = value; return "https://identity.example.test/authorize"; },
    async exchange() { exchanges++; return identity; },
  }, auth, security, () => now);
  const attempt = await oidc.start({ redirectUri });
  const body = { transaction: attempt.transaction, callbackUrl: `${redirectUri}?code=abc&state=${state}` };
  await assert.rejects(oidc.complete({ ...body, transaction: "0".repeat(64) }), { reason: "unauthorized" });
  now = attempt.expiresAt;
  await assert.rejects(oidc.complete(body), { reason: "unauthorized" });
  assert.equal(exchanges, 0);
  const fresh = await oidc.start({ redirectUri });
  const results = await Promise.allSettled([0, 1].map(() => oidc.complete({ transaction: fresh.transaction, callbackUrl: `${redirectUri}?code=abc&state=${state}` })));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(exchanges, 1);
});

test("OIDC provisioning policy, identity isolation and email collisions preserve existing ledgers", async (t) => {
  const db = openDatabase(":memory:"); t.after(() => db.close());
  const repositories = createRepositories(db);
  const auth = createAuthService({ ...repositories, security, allowRegistration: true });
  assert.throws(() => auth.loginOidc(identity, false), { reason: "forbidden" });
  const session = auth.loginOidc(identity, true);
  const userId = auth.authenticate(session.token).userId;
  assert.equal(auth.authenticate(auth.loginOidc({ ...identity, email: "new@example.test" }, false).token).userId, userId);
  assert.throws(() => auth.loginOidc({ ...identity, subject: "attacker" }, true), { reason: "conflict" });
  assert.throws(() => auth.loginOidc({ ...identity, issuer: "https://other.test" }, true), { reason: "conflict" });
  const passwordAccount = await auth.register({ email: "password@example.test", password: "correct password" });
  assert.throws(() => auth.loginOidc({ ...identity, subject: "different", email: passwordAccount.email }, true), { reason: "conflict" });
  await assert.rejects(auth.login({ email: identity.email, password: "correct password" }), { reason: "unauthorized" });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM oidc_identities").get()!.count, 1);
});

test("OIDC configuration is optional and rejects incomplete configuration", () => {
  assert.equal(oidcFromEnv({}), undefined);
  assert.throws(() => oidcFromEnv({ OIDC_ISSUER: issuer }), /OIDC requires/);
  assert.equal(oidcFromEnv({ OIDC_ISSUER: issuer, OIDC_CLIENT_ID: "penny", OIDC_REDIRECT_URIS: redirectUri })!.allowRegistration, false);
});
