import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { isSafeAuthorizationUrl, sessionSchema } from "../src/api/schemas";
import { sessionKey, userKey } from "../src/api/keys";
import { ALEX, bodyOf, callsTo, json, openSignOut, renderApp, stubServer } from "./render";

const personal = (title: string) => ({
  key: `personal:${title}`,
  source: "personal" as const,
  match: null,
  entry: { id: title, title, kind: "expense" as const, total: 1000, share: 500, categoryId: "food", date: "2026-11-02", note: "" },
});

describe("authorization URL and session token validation", () => {
  it.each([
    ["https://sso.example.test/authorize?state=s", true],
    ["http://localhost:9000/authorize", true],
    ["http://127.0.0.1:9000/authorize", true],
    ["http://sso.example.test/authorize", false],
    ["javascript:alert(1)", false],
    ["data:text/html,<script>1</script>", false],
    ["https://user:pass@sso.example.test/", false],
    ["not a url", false],
  ])("%s -> %s", (url, allowed) => {
    expect(isSafeAuthorizationUrl(url)).toBe(allowed);
  });

  it("does not fail a completed sign-in because the discarded token has another format", () => {
    expect(sessionSchema.safeParse({ token: "opaque-token-without-hex-shape", email: ALEX }).success).toBe(true);
    expect(sessionSchema.safeParse({ token: "", email: ALEX }).success).toBe(false);
  });
});

describe("session expiry", () => {
  it("cancels an in-flight session check so its late answer cannot restore the signed-in state", async () => {
    let calls = 0;
    let expired = false;
    let release: (response: Response) => void = () => undefined;
    const late = new Promise<Response>((resolve) => {
      release = resolve;
    });
    stubServer((url) => {
      if (url === "/api/auth/me") {
        calls += 1;
        return calls === 1 ? json({ email: ALEX }) : late;
      }
      if (url === "/api/v1/search/transactions" && expired) return json({ error: "Please sign in to continue." }, 401);
      return undefined;
    });
    const { queryClient } = renderApp("/transactions");
    await screen.findByText("No matching transactions.");
    void queryClient.refetchQueries({ queryKey: sessionKey });
    await waitFor(() => {
      expect(calls).toBe(2);
    });
    // A private request is rejected while the /me check is still in flight.
    expired = true;
    await queryClient.invalidateQueries({ queryKey: userKey(ALEX, "search") });
    expect(await screen.findByRole("heading", { level: 1, name: "Welcome back" })).toBeInTheDocument();
    // The older /me answer arrives after expiry and claims the user is still signed in.
    release(json({ email: ALEX }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByRole("heading", { level: 1, name: "Welcome back" })).toBeInTheDocument();
    expect(queryClient.getQueryData(sessionKey)).toBeNull();
  });
});

describe("search paging failures", () => {
  it("keeps loaded results when 'Show more' fails and retries only that page", async () => {
    let secondPageFails = true;
    const fetchMock = stubServer((url, init) => {
      if (url !== "/api/v1/search/transactions") return undefined;
      const cursor = (bodyOf(init) as { cursor?: string }).cursor;
      if (!cursor) return json({ version: 1, items: [personal("First")], totalCount: 2, nextCursor: "c1" });
      if (secondPageFails) return json({ error: "Search is busy." }, 503);
      return json({ version: 1, items: [personal("Second")], totalCount: 2, nextCursor: null });
    });
    const user = userEvent.setup();
    renderApp("/transactions");
    await user.click(await screen.findByRole("button", { name: "Show more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Search is busy.");
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(callsTo(fetchMock, "/api/v1/search/transactions")).toHaveLength(2);

    secondPageFails = false;
    await user.click(screen.getByRole("button", { name: "Try loading more again" }));
    expect(await screen.findByText("Second")).toBeInTheDocument();
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Retried the second page only: first page + failed second + successful second.
    const bodies = callsTo(fetchMock, "/api/v1/search/transactions").map((init) => bodyOf(init));
    expect(bodies).toEqual([{ pageSize: 50 }, { pageSize: 50, cursor: "c1" }, { pageSize: 50, cursor: "c1" }]);
  });
});

describe("personal amounts use the ledger currency", () => {
  it("formats a personal entry in the account's ledger currency", async () => {
    stubServer((url) => {
      if (url === "/api/ledger") return json({ revision: 1, ledger: { currency: "EUR" } });
      if (url === "/api/v1/search/transactions") return json({ version: 1, items: [personal("Bread")], totalCount: 1, nextCursor: null });
      return undefined;
    });
    renderApp("/transactions");
    expect(await screen.findByText("€5.00")).toBeInTheDocument();
  });

  it("shows a plain number rather than a wrong currency when the ledger can't be read", async () => {
    stubServer((url) => {
      if (url === "/api/ledger") return json({ error: "down" }, 500);
      if (url === "/api/v1/search/transactions") return json({ version: 1, items: [personal("Bread")], totalCount: 1, nextCursor: null });
      return undefined;
    });
    renderApp("/transactions");
    expect(await screen.findByText("Bread")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("5.00")).toBeInTheDocument();
    });
    expect(screen.queryByText(/[$€£]/)).not.toBeInTheDocument();
  });
});

describe("sign-out dialog is modal", () => {
  it("makes the page inert, traps Tab and Shift+Tab, and restores everything on close", async () => {
    stubServer();
    const user = userEvent.setup();
    const { container } = renderApp("/");
    await openSignOut(user);
    const dialog = screen.getByRole("dialog", { name: "Sign out of Penny?" });
    expect(container).toHaveAttribute("inert");
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const confirm = within(dialog).getByRole("button", { name: "Sign out" });
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(container).not.toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveFocus();
  });
});
