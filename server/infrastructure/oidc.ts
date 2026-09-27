import * as client from "openid-client";
import { z } from "zod";

import type { OidcOptions, OidcProvider } from "../application/ports.ts";

export function oidcFromEnv(env: Record<string, string | undefined>): OidcOptions | undefined {
  if (!env.OIDC_ISSUER && !env.OIDC_CLIENT_ID) return undefined;
  if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID || !env.OIDC_REDIRECT_URIS) {
    throw new Error("OIDC requires OIDC_ISSUER, OIDC_CLIENT_ID, and OIDC_REDIRECT_URIS.");
  }
  return {
    issuer: env.OIDC_ISSUER,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET || undefined,
    redirectUris: env.OIDC_REDIRECT_URIS.split(",").map((uri: string) => uri.trim()).filter(Boolean),
    label: env.OIDC_LABEL || "Single sign-on",
    allowRegistration: env.OIDC_ALLOW_REGISTRATION === "true",
  };
}

export function createOidcProvider(options: OidcOptions): OidcProvider {
  const issuer = new URL(options.issuer);
  if (issuer.protocol !== "https:" || issuer.search || issuer.hash || issuer.username || issuer.password) {
    throw new Error("OIDC_ISSUER must be an HTTPS issuer URL.");
  }
  if (!options.redirectUris.length) throw new Error("OIDC requires at least one redirect URI.");
  for (const uri of options.redirectUris) {
    const url = new URL(uri);
    if (url.search || url.hash || url.username || url.password ||
      !(url.protocol === "https:" || uri === "penny://auth/callback" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
      throw new Error("OIDC redirect URIs must use HTTPS, localhost HTTP, or penny://auth/callback, without query strings or fragments.");
    }
  }
  let discovery: Promise<client.Configuration> | undefined;
  function configuration() {
    discovery ??= client.discovery(issuer, options.clientId, options.clientSecret,
      options.clientSecret ? client.ClientSecretPost(options.clientSecret) : client.None(),
      { execute: [client.enableNonRepudiationChecks], timeout: 10 }).catch((error) => {
      discovery = undefined;
      throw error;
    });
    return discovery;
  }
  return {
    async authorize(redirectUri: string, state: string, nonce: string, verifier: string) {
      const config = await configuration();
      return client.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri, scope: "openid email profile", response_type: "code",
        state, nonce, code_challenge: await client.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256",
      }).href;
    },
    async exchange(callbackUrl: URL, state: string, nonce: string, verifier: string) {
      const config = await configuration();
      const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
        expectedState: state, expectedNonce: nonce, pkceCodeVerifier: verifier, idTokenExpected: true,
      });
      const claims = tokens.claims()!;
      // Some providers only expose email through UserInfo. Its subject must match the ID token.
      const profile = claims.email === undefined
        ? await client.fetchUserInfo(config, tokens.access_token, claims.sub)
        : claims;
      const email = z.email().max(254).parse(profile.email).toLowerCase();
      if (profile.email_verified !== true) throw new Error("OIDC requires a verified email.");
      return { issuer: claims.iss, subject: claims.sub, email };
    },
  };
}
