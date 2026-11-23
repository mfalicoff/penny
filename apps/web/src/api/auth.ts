import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiFetch } from "./client";
import { sessionKey } from "./keys";
import { expireSession } from "../auth/lifecycle";
import { emailVerifiedSchema, meSchema, oidcChallengeSchema, oidcConfigSchema, okSchema, profileSchema, sessionSchema, type EmailChange, type Me, type PasswordReset, type Profile } from "./schemas";

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

export async function register(credentials: Credentials & { displayName?: string }, signal?: AbortSignal): Promise<{ email: string }> {
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

/**
 * Asks for a reset email (MAZ-124). The server answers the same 202 whether or not the address
 * has an account; a 404 means it doesn't send email (any more).
 */
export async function requestPasswordReset(email: string, signal?: AbortSignal): Promise<void> {
  await apiFetch("/api/auth/password-reset/request", okSchema, { method: "POST", body: { email }, ...(signal ? { signal } : {}) });
}

/**
 * Redeems a reset code, from the operator or the emailed link, with a new password. The server
 * signs every device out and issues no session, so the person signs in again afterwards.
 */
export async function resetPassword(input: PasswordReset, signal?: AbortSignal): Promise<void> {
  await apiFetch("/api/auth/password-reset", okSchema, { method: "POST", body: input, ...(signal ? { signal } : {}) });
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
 * Who the browser is signed in as: `{ email }` with the profile summary (MAZ-171), or `null` when
 * there is no valid session.
 * A 401 is an answer, not a failure. Network and 5xx errors stay errors so a flaky
 * connection never signs anyone out.
 */
export const sessionQuery = queryOptions({
  queryKey: sessionKey,
  queryFn: async ({ signal, client }): Promise<Me | null> => {
    try {
      return await apiFetch("/api/auth/me", meSchema, { signal });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
      // Signed in a moment ago and now rejected: the session expired or ended elsewhere.
      if (client.getQueryData(sessionKey)) await expireSession(client, { cancelSession: false });
      return null;
    }
  },
  staleTime: 60_000,
});

/**
 * Email verification (MAZ-172). Redeems the code from the emailed link, signed in or not (the link
 * may be opened on another device), and answers the address it verified.
 */
export async function verifyEmail(token: string, signal?: AbortSignal): Promise<string> {
  const { email } = await apiFetch("/api/auth/email-verification", emailVerifiedSchema, { method: "POST", body: { token }, ...(signal ? { signal } : {}) });
  return email;
}

/**
 * Sends the signed-in account's verification email again. The server answers the same 202 whether
 * or not it queued one (a minute after the last one at the earliest); a 404 means it doesn't send email.
 */
export async function resendVerification(signal?: AbortSignal): Promise<void> {
  await apiFetch("/api/auth/email-verification/resend", okSchema, { method: "POST", body: {}, ...(signal ? { signal } : {}) });
}

/** Changes a password account's email after its password; the account is then unverified. */
export function changeEmail(input: EmailChange, signal?: AbortSignal): Promise<Profile> {
  return apiFetch("/api/auth/email", profileSchema, { method: "POST", body: input, ...(signal ? { signal } : {}) });
}
