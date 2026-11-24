import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OidcProvider } from "../src/api/schemas";
import { bodyOf, callsTo, json, renderApp, stubServer } from "./render";

// MAZ-170: the sign-in screens show one button per provider the server lists, and nothing for
// providers it doesn't list.

const apple: OidcProvider = { id: "apple", label: "Apple", icon: "apple", native: true };
const google: OidcProvider = { id: "google", label: "Google", icon: "google", native: false };
const sso: OidcProvider = { id: "sso", label: "Single sign-on", icon: "sso", native: false };
const transaction = "c".repeat(64);

function server(providers: OidcProvider[]) {
  return stubServer((url) => {
    if (url === "/api/auth/me") return json({ error: "Please sign in to continue." }, 401);
    if (url === "/api/auth/oidc") return json({ enabled: providers.length > 0, ...(providers[0] ? { label: providers[0].label } : {}), providers });
    if (url === "/api/auth/oidc/start")
      return json({ transaction, authorizationUrl: "https://appleid.apple.com/authorize?state=s", expiresAt: Date.now() + 600_000 });
    return undefined;
  });
}

const main = () => screen.getByRole("main");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sign-in providers", () => {
  it("shows no provider buttons when the server lists none", async () => {
    server([]);
    renderApp("/");
    await screen.findByRole("heading", { level: 1, name: "Welcome back" });
    await screen.findByRole("button", { name: "Sign in" });
    expect(within(main()).queryByRole("button", { name: /^(Sign in|Sign up|Continue) with/ })).toBeNull();
    expect(screen.queryByText("or use your email")).toBeNull();
  });

  it("lists every configured provider in the server's order, before the email form", async () => {
    server([apple, google, sso]);
    renderApp("/");
    await screen.findByRole("button", { name: "Sign in with Apple" });
    const names = within(main())
      .getAllByRole("button")
      .map((button) => button.textContent);
    const first = names.indexOf("Sign in with Apple");
    expect(names.slice(first, first + 3)).toEqual(["Sign in with Apple", "Sign in with Google", "Continue with Single sign-on"]);
    expect(names.indexOf("Sign in")).toBeGreaterThan(first + 2);
    expect(screen.getByText("or use your email")).toBeInTheDocument();
  });

  it("shows only what the server lists: no Google or Apple button when only SSO is configured, after the form", async () => {
    server([sso]);
    renderApp("/");
    const button = await screen.findByRole("button", { name: "Continue with Single sign-on" });
    expect(screen.queryByRole("button", { name: /Apple|Google/ })).toBeNull();
    const names = within(main())
      .getAllByRole("button")
      .map((element) => element.textContent);
    expect(names.indexOf("Sign in")).toBeLessThan(names.indexOf(button.textContent));
    expect(screen.queryByText("or use your email")).toBeNull();
  });

  it("says Sign up with on create account", async () => {
    server([apple, google]);
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Create an account" }));
    expect(await screen.findByRole("button", { name: "Sign up with Apple" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign up with Google" })).toBeInTheDocument();
  });

  it("starts the sign-in with the chosen provider", async () => {
    const fetchMock = server([apple, google]);
    vi.spyOn(window, "open").mockReturnValue({ closed: false, close: () => undefined, location: { href: "" } } as unknown as Window);
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Sign in with Google" }));
    await waitFor(() => {
      expect(callsTo(fetchMock, "/api/auth/oidc/start")).toHaveLength(1);
    });
    expect(bodyOf(callsTo(fetchMock, "/api/auth/oidc/start")[0])).toEqual({
      redirectUri: `${window.location.origin}/auth/callback`,
      provider: "google",
    });
    expect(screen.getByRole("button", { name: "Waiting for Google…" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Apple" })).toHaveAttribute("aria-disabled", "true");
  });
});
