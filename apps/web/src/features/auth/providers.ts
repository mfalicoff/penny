import type { OidcProvider } from "../../api/schemas";

/** Sign in or create an account: the auth screen's two modes. */
export type Mode = "sign-in" | "create-account";

/** Apple and Google buttons follow those providers' button rules; every other icon is a plain SSO button. */
export function isBrandProvider(icon: string): icon is "apple" | "google" {
  return icon === "apple" || icon === "google";
}

/** Apple and Google say "Sign in with" and "Sign up with", as their button rules ask; the server's own SSO says "Continue with". */
export function providerAction(provider: OidcProvider, mode: Mode): string {
  if (!isBrandProvider(provider.icon)) return `Continue with ${provider.label}`;
  return `${mode === "create-account" ? "Sign up" : "Sign in"} with ${provider.label}`;
}

/** Providers lead when Apple or Google is among them (web-sign-in-providers); a lone SSO follows the form (web-sign-in). */
export function providersPlacement(providers: readonly OidcProvider[]): "before-form" | "after-form" {
  return providers.some((provider) => isBrandProvider(provider.icon)) ? "before-form" : "after-form";
}
