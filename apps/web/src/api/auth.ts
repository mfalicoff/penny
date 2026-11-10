import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiFetch } from "./client";
import { sessionKey } from "./keys";
import { expireSession } from "../auth/lifecycle";
import { meSchema, oidcChallengeSchema, oidcConfigSchema, okSchema, sessionSchema } from "./schemas";

export interface Credentials {
  email: string;
  password: string;
}

/**
 * Password sign-in and registration. The API sets the HttpOnly `penny_session` cookie;
 * the `token` it also returns (for native clients) is dropped here on purpose, so no
 * script can ever read the credential.
 */
export async function login(credentials: Credentials, signal?: AbortSignal): Promise<{ email: string }> {
  const { email } = await apiFetch("/api/auth/login", sessionSchema, { method: "POST", body: credentials, ...(signal ? { signal } : {}) });
  return { email };
}

export async function register(credentials: Credentials, signal?: AbortSignal): Promise<{ email: string }> {
  const { email } = await apiFetch("/api/auth/register", sessionSchema, { method: "POST", body: credentials, ...(signal ? { signal } : {}) });
  return { email };
}

/** Ends the current session on the server. A 401 means it was already over, which is the goal. */
export async function logout(): Promise<void> {
  try {
    await apiFetch("/api/auth/logout", okSchema, { method: "POST", body: {} });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return;
    throw error;
  }
}

export const oidcConfigQuery = queryOptions({
  queryKey: ["server", "oidc"] as const,
  queryFn: ({ signal }) => apiFetch("/api/auth/oidc", oidcConfigSchema, { signal }),
  staleTime: 5 * 60_000,
});

export function startOidc(redirectUri: string, signal?: AbortSignal) {
  return apiFetch("/api/auth/oidc/start", oidcChallengeSchema, {
    method: "POST",
    body: { redirectUri },
    ...(signal ? { signal } : {}),
  });
}

export async function completeOidc(transaction: string, callbackUrl: string, signal?: AbortSignal): Promise<{ email: string }> {
  const { email } = await apiFetch("/api/auth/oidc/complete", sessionSchema, {
    method: "POST",
    body: { transaction, callbackUrl },
    ...(signal ? { signal } : {}),
  });
  return { email };
}

/**
 * Who the browser is signed in as: `{ email }`, or `null` when there is no valid session.
 * A 401 is an answer, not a failure. Network and 5xx errors stay errors so a flaky
 * connection never signs anyone out.
 */
export const sessionQuery = queryOptions({
  queryKey: sessionKey,
  queryFn: async ({ signal, client }): Promise<{ email: string } | null> => {
    try {
      return await apiFetch("/api/auth/me", meSchema, { signal });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
      // Signed in a moment ago and now rejected: the session expired or ended elsewhere.
      if (client.getQueryData(sessionKey)) await expireSession(client);
      return null;
    }
  },
  staleTime: 60_000,
});
