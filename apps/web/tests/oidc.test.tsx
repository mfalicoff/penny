import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALEX, bodyOf, callsTo, json, renderApp, stubServer, wasCalled } from "./render";

const token = "b".repeat(64);
const transaction = "c".repeat(64);
const providerUrl = "https://sso.example.test/authorize?client_id=penny&state=s";

interface FakePopup {
  closed: boolean;
  close: () => void;
  location: { href: string };
}

function fakePopup(): FakePopup {
  const popup: FakePopup = {
    closed: false,
    close: () => {
      popup.closed = true;
    },
    location: { href: "" },
  };
  return popup;
}

/** A server with SSO on. `complete` decides the outcome of /oidc/complete. */
function ssoServer(complete: () => Response = () => json({ token, email: ALEX })) {
  let signedIn = false;
  const fetchMock = stubServer((url) => {
    if (url === "/api/auth/me") return signedIn ? json({ email: ALEX }) : json({ error: "Please sign in to continue." }, 401);
    if (url === "/api/auth/oidc") return json({ enabled: true, label: "Acme SSO" });
    if (url === "/api/auth/oidc/start") return json({ transaction, authorizationUrl: providerUrl, expiresAt: Date.now() + 600_000 });
    if (url === "/api/auth/oidc/complete") {
      const response = complete();
      if (response.ok) signedIn = true;
      return response;
    }
    return undefined;
  });
  return fetchMock;
}

const callbackUrl = (query = "?code=abc&state=s") => `${window.location.origin}/auth/callback${query}`;

/** What the real callback page does inside the popup. */
function popupReturns(url: string) {
  const channel = new BroadcastChannel("penny-oidc");
  channel.postMessage({ type: "callback", url });
  return channel;
}

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("OIDC popup sign-in", () => {
  it("opens the popup on click, completes with the callback URL and signs in", async () => {
    const fetchMock = ssoServer();
    const popup = fakePopup();
    const open = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Continue with Acme SSO" }));
    expect(open).toHaveBeenCalledWith("about:blank", "penny-oidc", expect.stringContaining("popup"));
    await waitFor(() => {
      expect(popup.location.href).toBe(providerUrl);
    });
    const start = callsTo(fetchMock, "/api/auth/oidc/start")[0];
    expect(bodyOf(start)).toEqual({ redirectUri: `${window.location.origin}/auth/callback` });

    const channel = popupReturns(callbackUrl());
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    channel.close();
    const complete = callsTo(fetchMock, "/api/auth/oidc/complete")[0];
    expect(bodyOf(complete)).toEqual({ transaction, callbackUrl: callbackUrl() });
    expect(popup.closed).toBe(true);
    expect(JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)])).not.toContain(token);
  });

  it("ignores callback messages that are not this app's callback address", async () => {
    const fetchMock = ssoServer();
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Continue with Acme SSO" }));
    await waitFor(() => {
      expect(popup.location.href).toBe(providerUrl);
    });
    const channel = popupReturns("https://evil.example.test/auth/callback?code=x");
    popupReturns(`${window.location.origin}/other?code=x`).close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    channel.close();
    expect(wasCalled(fetchMock, "/api/auth/oidc/complete")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Cancel sign-in" }));
  });

  it("treats a closed popup as a cancellation and lets the user try again", async () => {
    const fetchMock = ssoServer();
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Continue with Acme SSO" }));
    await waitFor(() => {
      expect(popup.location.href).toBe(providerUrl);
    });
    popup.closed = true;
    expect(await screen.findByText("Sign-in was cancelled. Nothing changed.", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(wasCalled(fetchMock, "/api/auth/oidc/complete")).toBe(false);
    expect(screen.getByRole("heading", { level: 1, name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Acme SSO" })).toBeEnabled();
  });

  it("lets the user cancel while waiting and closes the popup", async () => {
    ssoServer();
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Continue with Acme SSO" }));
    await user.click(await screen.findByRole("button", { name: "Cancel sign-in" }));
    expect(await screen.findByText("Sign-in was cancelled. Nothing changed.")).toBeInTheDocument();
    expect(popup.closed).toBe(true);
  });

  it("reports a blocked popup and offers to continue in this tab", async () => {
    const fetchMock = ssoServer();
    vi.spyOn(window, "open").mockReturnValue(null);
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Continue with Acme SSO" }));
    expect(await screen.findByText(/blocked the sign-in window/)).toBeInTheDocument();
    expect(wasCalled(fetchMock, "/api/auth/oidc/start")).toBe(false);
    expect(screen.getByRole("button", { name: "Continue in this tab" })).toBeInTheDocument();
  });

  it("shows the server's message when the callback fails verification (state mismatch, cancelled at the provider)", async () => {
    ssoServer(() => json({ error: "Sign-in could not be verified. Please try again and allow access to your verified email." }, 401));
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Continue with Acme SSO" }));
    await waitFor(() => {
      expect(popup.location.href).toBe(providerUrl);
    });
    popupReturns(callbackUrl("?error=access_denied&state=wrong")).close();
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in could not be verified");
    expect(screen.getByRole("heading", { level: 1, name: "Welcome back" })).toBeInTheDocument();
  });

  it("does not offer SSO when the server has none", async () => {
    stubServer((url) => (url === "/api/auth/me" ? json({ error: "no" }, 401) : undefined));
    renderApp("/");
    await screen.findByRole("heading", { level: 1, name: "Welcome back" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("button", { name: /Continue with/ })).not.toBeInTheDocument();
  });
});

describe("OIDC callback page", () => {
  it("hands the URL to the waiting window, which answers, and tells the user they can close it", async () => {
    stubServer((url) => (url === "/api/auth/me" ? json({ error: "no" }, 401) : undefined));
    const opener = new BroadcastChannel("penny-oidc");
    opener.onmessage = (event: MessageEvent<{ type: string }>) => {
      if (event.data.type === "callback") opener.postMessage({ type: "ack" });
    };
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);
    renderApp("/auth/callback?code=abc&state=s");
    expect(await screen.findByRole("heading", { name: "You're signed in" })).toBeInTheDocument();
    expect(close).toHaveBeenCalled();
    opener.close();
  });

  it("finishes a redirect-flow sign-in itself and continues to Home", async () => {
    const fetchMock = ssoServer();
    sessionStorage.setItem("penny.oidc.attempt", JSON.stringify({ transaction, expiresAt: Date.now() + 1000 }));
    const { router } = renderApp("/auth/callback?code=abc&state=s");
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    const complete = callsTo(fetchMock, "/api/auth/oidc/complete")[0];
    expect(bodyOf(complete)).toMatchObject({ transaction });
    expect(sessionStorage.getItem("penny.oidc.attempt")).toBeNull();
  });

  it("explains a callback that has no attempt behind it, without calling the API", async () => {
    const fetchMock = ssoServer();
    renderApp("/auth/callback?code=abc&state=s");
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer valid");
    expect(screen.getByRole("link", { name: "Back to sign-in" })).toHaveAttribute("href", "/");
    expect(wasCalled(fetchMock, "/api/auth/oidc/complete")).toBe(false);
  });

  it("shows an expired or replayed attempt as a failed sign-in", async () => {
    ssoServer(() => json({ error: "Sign-in expired. Please try again." }, 401));
    sessionStorage.setItem("penny.oidc.attempt", JSON.stringify({ transaction, expiresAt: 1 }));
    renderApp("/auth/callback?code=abc&state=s");
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in expired. Please try again.");
    expect(screen.getByRole("heading", { name: "Sign-in didn't finish" })).toBeInTheDocument();
  });

  it("is reachable while signed out and does not ask for the session", async () => {
    const fetchMock = ssoServer();
    renderApp("/auth/callback");
    await screen.findByRole("alert");
    expect(wasCalled(fetchMock, "/api/auth/me")).toBe(false);
  });
});
