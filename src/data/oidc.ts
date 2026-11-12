import * as WebBrowser from "expo-web-browser";
import { api } from "./api";
import { setToken } from "./session";

export type OidcAttempt = { transaction: string; authorizationUrl: string; expiresAt: number };
export function oidcRedirectUri() {
  return "penny://auth/callback";
}
export async function oidcConfiguration(): Promise<{ enabled: boolean; label?: string }> {
  return (await api("/auth/oidc")).json();
}
export async function prepareOidc(): Promise<OidcAttempt> {
  return (await api("/auth/oidc/start", { method: "POST", body: JSON.stringify({ redirectUri: oidcRedirectUri() }) })).json();
}
export async function signInOidc(attempt: OidcAttempt): Promise<string | null> {
  if (attempt.expiresAt <= Date.now()) throw new Error("Sign-in expired. Please try again.");
  const result = await WebBrowser.openAuthSessionAsync(attempt.authorizationUrl, oidcRedirectUri());
  if (result.type !== "success") return null;
  const session = await (await api("/auth/oidc/complete", {
    method: "POST", body: JSON.stringify({ transaction: attempt.transaction, callbackUrl: result.url }),
  })).json();
  await setToken(session.token);
  return session.email;
}
