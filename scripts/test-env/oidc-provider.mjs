// A local OpenID Connect provider for full-stack runs (MAZ-62): discovery, an
// auto-approving authorization endpoint, Authorization Code + S256 PKCE token exchange,
// RS256 ID tokens and JWKS, over HTTPS with the run's throwaway certificate (tls.mjs; the
// API serves HTTPS with the same one). The .NET API trusts exactly that certificate through
// `TestControls__OidcCertificate`; browsers in test runs ignore HTTPS errors.
//
// Identity: `login_hint` picks the subject (default `oidc-user`); the email is
// `<subject>@penny.test`. Controls (token-guarded like the API's):
//   PUT /control {"emailVerified": false} | {"fail": "token"|"authorize"|null}
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { selfSignedCertificate } from "./tls.mjs";

export { selfSignedCertificate };
export const clientId = "penny-test";
export const defaultWebPort = 4173;

/**
 * The callbacks the provider and the API accept: the web app on each given port (4173, the
 * dev server's default, and the run's own web port) on localhost and 127.0.0.1, and the native app.
 * @param {number[]} [webPorts]
 */
export function redirectUrisFor(webPorts = []) {
  const ports = [...new Set([defaultWebPort, ...webPorts])];
  return [
    ...ports.flatMap((port) => [`http://localhost:${port}/auth/callback`, `http://127.0.0.1:${port}/auth/callback`]),
    "penny://auth/callback",
  ];
}

export const redirectUris = redirectUrisFor();

// --- Provider ---------------------------------------------------------------------
const base64url = (value) => Buffer.from(value).toString("base64url");

function readForm(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 65_536) reject(new Error("too large"));
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

/**
 * Starts the provider on 127.0.0.1 with a random port. `tls` is the run's certificate
 * ({ pem, key, certificate }: the PEMs and the certificate's path, from tls.mjs); without it the
 * provider makes its own. `webPorts` adds the run's web port to the accepted redirect URIs.
 * @param {{ host?: string, tls?: { pem: string, key: string, certificate: string }, webPorts?: number[] }} [options]
 */
export async function startOidcProvider({ host = "127.0.0.1", tls, webPorts = [] } = {}) {
  let certificate = tls;
  let certificatePath = tls?.certificate;
  if (!certificate) {
    certificate = selfSignedCertificate();
    certificatePath = join(mkdtempSync(join(tmpdir(), "penny-oidc-")), "certificate.pem");
    writeFileSync(certificatePath, certificate.pem, { mode: 0o600 });
  }
  const redirectUris = redirectUrisFor(webPorts);
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyId = randomBytes(8).toString("hex");
  const jwk = { ...createPublicKey(privateKey).export({ format: "jwk" }), kid: keyId, use: "sig", alg: "RS256" };
  const codes = new Map();
  const settings = { emailVerified: true, fail: null };
  let controlToken = randomBytes(32).toString("hex");
  let issuer = "";

  const json = (response, status, value) => {
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(value));
  };

  const server = createServer({ cert: certificate.pem, key: certificate.key }, async (request, response) => {
    try {
      const url = new URL(request.url, issuer);
      if (request.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
        return json(response, 200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ["openid", "email", "profile"],
          token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
          grant_types_supported: ["authorization_code"],
        });
      }
      if (request.method === "GET" && url.pathname === "/jwks") return json(response, 200, { keys: [jwk] });
      if (request.method === "GET" && url.pathname === "/authorize") {
        const query = url.searchParams;
        const redirect = query.get("redirect_uri");
        if (query.get("client_id") !== clientId || !redirectUris.includes(redirect) || query.get("response_type") !== "code"
          || query.get("code_challenge_method") !== "S256" || !query.get("code_challenge") || !query.get("nonce"))
          return json(response, 400, { error: "invalid_request" });
        const target = new URL(redirect);
        if (settings.fail === "authorize") target.searchParams.set("error", "access_denied");
        else {
          const code = randomBytes(24).toString("hex");
          const subject = /^[a-z0-9-]{1,40}$/.test(query.get("login_hint") ?? "") ? query.get("login_hint") : "oidc-user";
          codes.set(code, { subject, nonce: query.get("nonce"), challenge: query.get("code_challenge"), redirect, expires: Date.now() + 60_000 });
          target.searchParams.set("code", code);
        }
        if (query.get("state")) target.searchParams.set("state", query.get("state"));
        response.writeHead(302, { location: target.toString(), "cache-control": "no-store" });
        return response.end();
      }
      if (request.method === "POST" && url.pathname === "/token") {
        if (settings.fail === "token") return json(response, 503, { error: "temporarily_unavailable" });
        const form = new URLSearchParams(await readForm(request));
        const grant = codes.get(form.get("code") ?? "");
        codes.delete(form.get("code") ?? "");
        const verifier = form.get("code_verifier") ?? "";
        if (!grant || grant.expires < Date.now() || form.get("grant_type") !== "authorization_code"
          || form.get("client_id") !== clientId || form.get("redirect_uri") !== grant.redirect
          || createHash("sha256").update(verifier).digest("base64url") !== grant.challenge)
          return json(response, 400, { error: "invalid_grant" });
        // Real time: the API validates ID token lifetime with the system clock.
        const now = Math.floor(Date.now() / 1000);
        const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: keyId }));
        const payload = base64url(JSON.stringify({
          iss: issuer, aud: clientId, sub: grant.subject, email: `${grant.subject}@penny.test`,
          email_verified: settings.emailVerified, nonce: grant.nonce, iat: now, exp: now + 300,
        }));
        const signature = sign("sha256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
        return json(response, 200, {
          access_token: randomBytes(24).toString("hex"), token_type: "Bearer", expires_in: 300,
          id_token: `${header}.${payload}.${signature}`,
        });
      }
      if (request.method === "PUT" && url.pathname === "/control") {
        if (request.headers["x-penny-test-token"] !== controlToken) return json(response, 403, { error: "forbidden" });
        const body = JSON.parse((await readForm(request)) || "{}");
        if (typeof body.emailVerified === "boolean") settings.emailVerified = body.emailVerified;
        if (body.fail === null || ["token", "authorize"].includes(body.fail)) settings.fail = body.fail;
        return json(response, 200, settings);
      }
      return json(response, 404, { error: "not_found" });
    } catch {
      return json(response, 500, { error: "server_error" });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  issuer = `https://${host}:${server.address().port}`;
  return {
    issuer,
    certificatePath,
    settings: { issuer, clientId, redirectUris, certificate: certificatePath, allowRegistration: true },
    // The environment's control token also guards the provider's controls.
    attach(state) {
      controlToken = state.controlToken;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
