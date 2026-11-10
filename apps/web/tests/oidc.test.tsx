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
function ssoServer(complete: () => Response = () => json({ token, email: ALEX }), start?: () => Response | Promise<Response>) {
  let signedIn = false;
  const fetchMock = stubServer((url) => {
    if (url === "/api/auth/me") return signedIn ? json({ email: ALEX }) : json({ error: "Please sign in to continue." }, 401);
    if (url === "/api/auth/oidc") return json({ enabled: true, label: "Acme SSO" });
    if (url === "/api/auth/oidc/start") return start?.() ?? json({ transaction, authorizationUrl: providerUrl, expiresAt: Date.now() + 600_000 });
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

  it("does not cancel on its own when the popup reports closed (COOP providers do that mid sign-in)", async () => {
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
    expect(await screen.findByText(/sign-in window looks closed/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText("Sign-in was cancelled. Nothing changed.")).not.toBeInTheDocument();
    // The user is still signing in somewhere: the callback still completes the attempt.
    popupReturns(callbackUrl()).close();
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    expect(wasCalled(fetchMock, "/api/auth/oidc/complete")).toBe(true);
  });

  it("lets the user cancel after the window was closed and try again", async () => {
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
    await screen.findByText(/sign-in window looks closed/, {}, { timeout: 3000 });
    await user.click(screen.getByRole("button", { name: "Cancel sign-in" }));
    expect(await screen.findByText("Sign-in was cancelled. Nothing changed.")).toBeInTheDocument();
    expect(wasCalled(fetchMock, "/api/auth/oidc/complete")).toBe(false);
    expect(screen.getByRole("button", { name: "Continue with Acme SSO" })).toBeEnabled();
  });

  it("shows the cancelled notice, not an error, when cancelled while the attempt is starting", async () => {
    let release: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    ssoServer(undefined, () => pending);
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Continue with Acme SSO" }));
    await user.click(await screen.findByRole("button", { name: "Cancel sign-in" }));
    expect(await screen.findByText("Sign-in was cancelled. Nothing changed.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(popup.closed).toBe(true);
    release(json({ transaction, authorizationUrl: providerUrl, expiresAt: Date.now() + 600_000 }));
  });

  it("cannot cancel once the callback arrived, so a created session is never reported as a failure", async () => {
    let release: (response: Response) => void = () => undefined;
    const completing = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = stubServer((url) => {
      if (url === "/api/auth/me") return json({ error: "no" }, 401);
      if (url === "/api/auth/oidc") return json({ enabled: true, label: "Acme SSO" });
      if (url === "/api/auth/oidc/start") return json({ transaction, authorizationUrl: providerUrl, expiresAt: Date.now() + 600_000 });
      if (url === "/api/auth/oidc/complete") return completing;
      return undefined;
    });
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Continue with Acme SSO" }));
    await waitFor(() => {
      expect(popup.location.href).toBe(providerUrl);
    });
    popupReturns(callbackUrl()).close();
    await waitFor(() => {
      expect(wasCalled(fetchMock, "/api/auth/oidc/complete")).toBe(true);
    });
    await user.click(screen.getByRole("button", { name: "Cancel sign-in" }));
    const init = callsTo(fetchMock, "/api/auth/oidc/complete")[0];
    expect(init?.signal).toBeNull();
    release(json({ token, email: ALEX }));
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  it("ignores another attempt's callback: only this attempt's state is accepted and acknowledged", async () => {
    const fetchMock = ssoServer();
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const acks: unknown[] = [];
    const listener = new BroadcastChannel("penny-oidc");
    listener.onmessage = (event: MessageEvent<{ type: string }>) => {
      if (event.data.type === "ack") acks.push(event.data);
    };
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Continue with Acme SSO" }));
    await waitFor(() => {
      expect(popup.location.href).toBe(providerUrl);
    });
    popupReturns(callbackUrl("?code=other&state=someone-elses")).close();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(wasCalled(fetchMock, "/api/auth/oidc/complete")).toBe(false);
    expect(acks).toEqual([]);
    popupReturns(callbackUrl()).close();
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    expect(acks).toEqual([{ type: "ack", state: "s" }]);
    listener.close();
  });

  it("refuses an attempt that is already expired, and a provider address that isn't https", async () => {
    ssoServer(undefined, () => json({ transaction, authorizationUrl: providerUrl, expiresAt: Date.now() - 1 }));
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const user = userEvent.setup();
    const first = renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Continue with Acme SSO" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("took too long");
    first.unmount();

    ssoServer(undefined, () => json({ transaction, authorizationUrl: "javascript:alert(1)", expiresAt: Date.now() + 600_000 }));
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Continue with Acme SSO" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("doesn't understand");
    expect(popup.location.href).not.toContain("javascript:");
  });

  it("gives up when the attempt's expiry passes while waiting at the provider", async () => {
    ssoServer(undefined, () => json({ transaction, authorizationUrl: providerUrl, expiresAt: Date.now() + 300 }));
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Continue with Acme SSO" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("took too long");
    expect(popup.closed).toBe(true);
  });

  it("has no Cancel button in the in-tab fallback, where there is nothing to cancel", async () => {
    ssoServer();
    vi.spyOn(window, "open").mockReturnValue(null);
    const assign = vi.fn();
    vi.stubGlobal("location", { origin: window.location.origin, assign });
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Continue with Acme SSO" }));
    await user.click(await screen.findByRole("button", { name: "Continue in this tab" }));
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(providerUrl);
    });
    expect(screen.queryByRole("button", { name: "Cancel sign-in" })).not.toBeInTheDocument();
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
    popupReturns(callbackUrl("?error=access_denied&state=s")).close();
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
    opener.onmessage = (event: MessageEvent<{ type: string; url?: string }>) => {
      if (event.data.type === "callback") opener.postMessage({ type: "ack", state: new URL(event.data.url ?? "").searchParams.get("state") });
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

  it("shows the server's verdict for a replayed attempt", async () => {
    ssoServer(() => json({ error: "Sign-in expired. Please try again." }, 401));
    sessionStorage.setItem("penny.oidc.attempt", JSON.stringify({ transaction, expiresAt: Date.now() + 1000 }));
    renderApp("/auth/callback?code=abc&state=s");
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in expired. Please try again.");
    expect(screen.getByRole("heading", { name: "Sign-in didn't finish" })).toBeInTheDocument();
  });

  it("enforces the stored expiry locally without calling the API", async () => {
    const fetchMock = ssoServer();
    sessionStorage.setItem("penny.oidc.attempt", JSON.stringify({ transaction, expiresAt: 1 }));
    renderApp("/auth/callback?code=abc&state=s");
    expect(await screen.findByRole("alert")).toHaveTextContent("took too long");
    expect(wasCalled(fetchMock, "/api/auth/oidc/complete")).toBe(false);
  });

  it("is reachable while signed out and does not ask for the session", async () => {
    const fetchMock = ssoServer();
    renderApp("/auth/callback");
    await screen.findByRole("alert");
    expect(wasCalled(fetchMock, "/api/auth/me")).toBe(false);
  });
});
