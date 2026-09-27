import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { api } from "./api";
import { setToken } from "./session";

// Complete web popups as soon as the root layout imports this module, before the session gate.
if (Platform.OS === "web" && typeof window !== "undefined" && window.location.pathname === "/auth/callback") {
  WebBrowser.maybeCompleteAuthSession();
}
export const isOidcCallback = () => Platform.OS === "web" && typeof window !== "undefined" && window.location.pathname === "/auth/callback";
export type OidcAttempt = { transaction: string; authorizationUrl: string; expiresAt: number };
export function oidcRedirectUri() {
  return Platform.OS === "web" ? `${window.location.origin}/auth/callback` : "penny://auth/callback";
}
export async function oidcConfiguration(): Promise<{ enabled: boolean; label?: string }> {
  return (await api("/auth/oidc")).json();
}
export async function prepareOidc(): Promise<OidcAttempt> {
  return (await api("/auth/oidc/start", { method: "POST", body: JSON.stringify({ redirectUri: oidcRedirectUri() }) })).json();
}
export async function signInOidc(attempt: OidcAttempt): Promise<string | null> {
  if (attempt.expiresAt <= Date.now()) throw new Error("Sign-in expired. Please try again.");
  // Called directly on press, with no preceding await, so web browsers permit the popup.
  const result = await WebBrowser.openAuthSessionAsync(attempt.authorizationUrl, oidcRedirectUri());
  if (result.type !== "success") return null;
  const session = await (await api("/auth/oidc/complete", {
    method: "POST", body: JSON.stringify({ transaction: attempt.transaction, callbackUrl: result.url }),
  })).json();
  await setToken(session.token);
  return session.email;
}
