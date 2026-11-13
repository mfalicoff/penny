import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionKey, userKey } from "../src/api/keys";
import { registerPendingChanges } from "../src/auth/pendingChanges";
import { searchTransactionsQuery } from "../src/api/search";
import { ALEX, bodyOf, callsTo, emptySearch, json, openSignOut, renderApp, stubServer, wasCalled } from "./render";

const token = "a".repeat(64);
const BOB = "bob@example.test";
const PASSWORD = "correct horse battery";

/** A tiny in-memory API: who is signed in, and what each login does. */
function fakeApi(initial: string | null, options: { login?: () => Response; register?: () => Response; search?: () => Response | Promise<Response> } = {}) {
  const state = { email: initial };
  const fetchMock = stubServer((url, init) => {
    if (url === "/api/auth/me") return state.email ? json({ email: state.email }) : json({ error: "Please sign in to continue." }, 401);
    if (url === "/api/auth/login") {
      const response = options.login?.();
      if (response) return response;
      state.email = (bodyOf(init) as { email: string }).email;
      return json({ token, email: state.email });
    }
    if (url === "/api/auth/register") {
      const response = options.register?.();
      if (response) return response;
      state.email = (bodyOf(init) as { email: string }).email;
      return json({ token, email: state.email }, 201);
    }
    if (url === "/api/auth/logout") {
      state.email = null;
      return json({ ok: true });
    }
    if (url === "/api/v1/search/transactions") return options.search?.();
    return undefined;
  });
  return { state, fetchMock };
}

async function signIn(user: ReturnType<typeof userEvent.setup>, email: string, password = PASSWORD) {
  await user.type(await screen.findByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

const search = (title: string) => ({
  ...emptySearch,
  totalCount: 1,
  items: [
    {
      key: `personal:${title}`,
      source: "personal",
      match: null,
      entry: { id: title, title, kind: "expense", total: 1000, share: 500, categoryId: "food", date: "2026-11-02", note: "" },
    },
  ],
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("password sign-in", () => {
  it("shows sign-in to a signed-out browser, with no private request", async () => {
    const { fetchMock } = fakeApi(null);
    renderApp("/transactions");
    expect(await screen.findByRole("heading", { level: 1, name: "Welcome back" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
    expect(wasCalled(fetchMock, "/api/v1/search/transactions")).toBe(false);
  });

  it("signs in, opens the deep link that was asked for, and never keeps the session token", async () => {
    const { fetchMock } = fakeApi(null);
    const user = userEvent.setup();
    renderApp("/transactions");
    await signIn(user, "alex@example.test");
    expect(await screen.findByRole("heading", { level: 1, name: "Activity" })).toBeInTheDocument();
    const login = callsTo(fetchMock, "/api/auth/login")[0];
    expect(login).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(bodyOf(login)).toEqual({ email: "alex@example.test", password: PASSWORD });
    expect(JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)])).not.toContain(token);
    expect(document.cookie).not.toContain("penny_session");
    expect(screen.getByText("alex@example.test")).toBeInTheDocument();
  });

  it("explains a wrong password, keeps the email, clears and focuses the password", async () => {
    fakeApi(null, { login: () => json({ error: "Email or password is incorrect." }, 401) });
    const user = userEvent.setup();
    renderApp("/");
    await signIn(user, "alex@example.test");
    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
    expect(screen.getByLabelText("Email")).toHaveValue("alex@example.test");
    await waitFor(() => {
      expect(screen.getByLabelText("Password")).toHaveFocus();
    });
    expect(screen.getByLabelText("Password")).toHaveValue("");
    // The user can retry on the same form.
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("validates before sending and focuses the first invalid field", async () => {
    const { fetchMock } = fakeApi(null);
    const user = userEvent.setup();
    renderApp("/");
    await user.type(await screen.findByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    const email = screen.getByLabelText("Email");
    expect(email).toHaveFocus();
    expect(email).toHaveAccessibleDescription("Enter a valid email address.");
    expect(email).toBeInvalid();
    expect(wasCalled(fetchMock, "/api/auth/login")).toBe(false);

    await user.clear(email);
    await user.type(email, "alex@example.test");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByLabelText("Password")).toHaveFocus();
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription(/10 to 256 characters/);
  });

  it.each([
    [500, "The server had a problem. Try again in a moment."],
    [429, "Too many attempts. Please try again in 15 minutes."],
  ])("reports a %i response without losing the form", async (status, message) => {
    fakeApi(null, { login: () => json({ error: status === 429 ? message : "boom" }, status) });
    const user = userEvent.setup();
    renderApp("/");
    await signIn(user, "alex@example.test");
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Email")).toHaveValue("alex@example.test");
  });

  it("reports an unreachable server", async () => {
    fakeApi(null, {
      login: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const user = userEvent.setup();
    renderApp("/");
    await signIn(user, "alex@example.test");
    expect(await screen.findByRole("alert")).toHaveTextContent("Penny can't reach the server.");
  });

  it("registers a new account and reports a duplicate email on the email field", async () => {
    fakeApi(null, { register: () => json({ error: "An account with this email already exists." }, 409) });
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Create an account" }));
    expect(screen.getByRole("heading", { level: 1, name: "Create your account" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), "alex@example.test");
    await user.type(screen.getByLabelText("Password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("An account with this email already exists.");
    await waitFor(() => {
      expect(screen.getByLabelText("Email")).toHaveFocus();
    });
    expect(screen.getByLabelText("Password")).toHaveValue(PASSWORD);
  });

  it("creates an account and lands in the app", async () => {
    fakeApi(null);
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Create an account" }));
    await user.type(screen.getByLabelText("Email"), "new@example.test");
    await user.type(screen.getByLabelText("Password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  it("does not sign anyone out when the session check fails with a server error", async () => {
    let failing = false;
    stubServer((url) => {
      if (url === "/api/auth/me") return failing ? json({ error: "down" }, 503) : json({ email: ALEX });
      return undefined;
    });
    const { queryClient } = renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    failing = true;
    await queryClient.refetchQueries({ queryKey: sessionKey }).catch(() => undefined);
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    expect(queryClient.getQueryData(sessionKey)).toEqual({ email: ALEX });
  });

  it("offers a retry when the first session check cannot reach the server", async () => {
    stubServer((url) => (url === "/api/auth/me" ? json({ error: "down" }, 503) : undefined));
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Penny can't reach the server" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("session expiry and sign-out", () => {
  it("returns to sign-in with a notice when a private request is rejected, and drops cached data", async () => {
    let expired = false;
    stubServer((url) => {
      if (url === "/api/v1/search/transactions" && expired) return json({ error: "Please sign in to continue." }, 401);
      if (url === "/api/auth/me" && expired) return json({ error: "Please sign in to continue." }, 401);
      if (url === "/api/v1/search/transactions") return json(search("Coffee"));
      return undefined;
    });
    const { queryClient } = renderApp("/transactions");
    expect(await screen.findByText("Coffee")).toBeInTheDocument();
    expired = true;
    await queryClient.invalidateQueries({ queryKey: userKey(ALEX, "search") });
    expect(await screen.findByRole("heading", { level: 1, name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Your session ended");
    expect(queryClient.getQueriesData({ queryKey: ["user"] }).filter(([, data]) => data !== undefined)).toEqual([]);
  });

  it("signs out through a confirmation and clears the account's cache", async () => {
    const { fetchMock } = fakeApi(ALEX, { search: () => json(search("Coffee")) });
    const user = userEvent.setup();
    const { queryClient } = renderApp("/transactions");
    expect(await screen.findByText("Coffee")).toBeInTheDocument();
    await openSignOut(user);
    const dialog = screen.getByRole("dialog", { name: "Sign out of Penny?" });
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Welcome back" })).toBeInTheDocument();
    expect(callsTo(fetchMock, "/api/auth/logout").map((init) => init?.method)).toEqual(["POST"]);
    expect(queryClient.getQueriesData({ queryKey: ["user"] })).toEqual([]);
    expect(queryClient.getQueryData(sessionKey)).toBeNull();
    expect(screen.queryByRole("status", { name: /ended/ })).not.toBeInTheDocument();
  });

  it("cancels sign-out with Escape and returns focus to the button", async () => {
    fakeApi(ALEX);
    const user = userEvent.setup();
    renderApp("/");
    await openSignOut(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveFocus();
  });

  it("refuses to sign out while changes are waiting to sync", async () => {
    const { fetchMock } = fakeApi(ALEX);
    const user = userEvent.setup();
    renderApp("/");
    await openSignOut(user);
    // Registered after the app's own offline store, so this stand-in answers (offline.test.tsx uses the real store).
    const unregister = registerPendingChanges((email) => email === ALEX);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your changes are still waiting to sync");
    expect(wasCalled(fetchMock, "/api/auth/logout")).toBe(false);
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    unregister();
  });

  it("keeps the user signed in and explains when the server cannot sign them out", async () => {
    stubServer((url) => (url === "/api/auth/logout" ? json({ error: "boom" }, 500) : undefined));
    const user = userEvent.setup();
    renderApp("/");
    await openSignOut(user);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The server had a problem");
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
  });
});

describe("account isolation", () => {
  it("never shows one account's cached results to the next account", async () => {
    const api = fakeApi(ALEX, {});
    const bodies: string[] = [];
    stubServer((url) => {
      if (url === "/api/v1/search/transactions") {
        bodies.push(api.state.email ?? "");
        return json(search(api.state.email === ALEX ? "Alex coffee" : "Bob rent"));
      }
      if (url === "/api/auth/me") return api.state.email ? json({ email: api.state.email }) : json({ error: "no" }, 401);
      if (url === "/api/auth/login") {
        api.state.email = BOB;
        return json({ token, email: BOB });
      }
      if (url === "/api/auth/logout") {
        api.state.email = null;
        return json({ ok: true });
      }
      return undefined;
    });
    const user = userEvent.setup();
    const { queryClient } = renderApp("/transactions");
    expect(await screen.findByText("Alex coffee")).toBeInTheDocument();
    await openSignOut(user);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sign out" }));
    await signIn(user, BOB);
    await user.click(within(await screen.findByRole("navigation", { name: "Main" })).getByRole("link", { name: "Activity" }));
    expect(await screen.findByText("Bob rent")).toBeInTheDocument();
    expect(screen.queryByText("Alex coffee")).not.toBeInTheDocument();
    expect(bodies).toEqual([ALEX, BOB]);
    const keys = queryClient.getQueryCache().getAll().map((query) => JSON.stringify(query.queryKey));
    expect(keys.filter((key) => key.includes(ALEX))).toEqual([]);
  });

  it("does not let a late response restore the previous account's data after sign-out", async () => {
    let release: (response: Response) => void = () => undefined;
    const late = new Promise<Response>((resolve) => {
      release = resolve;
    });
    fakeApi(ALEX, { search: () => late });
    const user = userEvent.setup();
    const { queryClient } = renderApp("/transactions");
    expect(await screen.findByText("Searching…")).toBeInTheDocument();
    // Sign-out lives in Settings. Keep a search in flight there too, so the late reply has somewhere to land.
    void queryClient.infiniteQuery(searchTransactionsQuery(ALEX, { query: "secret" })).catch(() => undefined);
    await openSignOut(user);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Welcome back" })).toBeInTheDocument();
    release(json(search("Alex secret")));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("Alex secret")).not.toBeInTheDocument();
    expect(queryClient.getQueriesData({ queryKey: ["user"] })).toEqual([]);
    expect(queryClient.getQueryData(sessionKey)).toBeNull();
  });

  it("does not let a late session check sign the previous account back in", async () => {
    let calls = 0;
    let release: (response: Response) => void = () => undefined;
    const late = new Promise<Response>((resolve) => {
      release = resolve;
    });
    fakeApi(ALEX);
    stubServer((url) => {
      if (url === "/api/auth/me") {
        calls += 1;
        return calls === 1 ? json({ email: ALEX }) : late;
      }
      if (url === "/api/auth/logout") return json({ ok: true });
      return undefined;
    });
    const user = userEvent.setup();
    const { queryClient } = renderApp("/");
    await screen.findByRole("heading", { level: 1, name: "Home" });
    void queryClient.refetchQueries({ queryKey: sessionKey });
    await waitFor(() => {
      expect(calls).toBe(2);
    });
    await openSignOut(user);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Welcome back" })).toBeInTheDocument();
    release(json({ email: ALEX }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole("heading", { level: 1, name: "Welcome back" })).toBeInTheDocument();
    expect(queryClient.getQueryData(sessionKey)).toBeNull();
  });
});
