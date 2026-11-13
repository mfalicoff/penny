import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { invalidateSearch, monthRange, normalizeFilters, searchTransactionsQuery } from "../src/api/search";
import { ALEX, bodyOf, callsTo, emptySearch, json, renderApp, stubServer } from "./render";

const personal = (title: string, share = 500) => ({
  key: `personal:${title}`,
  source: "personal" as const,
  match: "title" as const,
  entry: { id: title, title, kind: "expense" as const, total: 1000, share, categoryId: "food", date: "2026-11-02", note: "" },
});

const shared = {
  key: "shared:e1",
  source: "shared" as const,
  match: "meaning" as const,
  entry: {
    id: "e1",
    householdId: "h1",
    householdName: "Maison",
    householdCurrency: "EUR" as const,
    title: "Hydro",
    date: "2026-11-03",
    totalCents: 9000,
    shareCents: 3000,
    payerUserId: "u1",
    category: { name: "Bills", icon: "flash-outline", color: "#336699" },
    note: "",
  },
};

describe("search keys and helpers", () => {
  it("scopes the key to the account, the filters and the query text", () => {
    const a = searchTransactionsQuery(ALEX, { query: "coffee", source: "shared" }).queryKey;
    const b = searchTransactionsQuery("bob@example.test", { query: "coffee", source: "shared" }).queryKey;
    const c = searchTransactionsQuery(ALEX, { query: "tea", source: "shared" }).queryKey;
    expect(a.slice(0, 3)).toEqual(["user", ALEX, "search"]);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("gives equal searches one key whatever the field order or padding", () => {
    expect(searchTransactionsQuery(ALEX, { sort: "date-asc", query: "  rent " }).queryKey).toEqual(
      searchTransactionsQuery(ALEX, { query: "rent", sort: "date-asc" }).queryKey,
    );
    expect(normalizeFilters({ query: "   " })).toEqual({});
  });

  it("turns a month into real first and last days", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2026-13")).toEqual({});
    expect(monthRange(undefined)).toEqual({});
  });
});

describe("search results", () => {
  it("lists personal and shared results with amounts and where they came from", async () => {
    stubServer((url) =>
      url === "/api/v1/search/transactions" ? json({ version: 1, items: [personal("Coffee beans"), shared], totalCount: 2, nextCursor: null }) : undefined,
    );
    renderApp("/transactions?q=beverage");
    expect(await screen.findByText("Coffee beans")).toBeInTheDocument();
    expect(screen.getByText("2 matching transactions")).toBeInTheDocument();
    expect(screen.getByText(/Shared · Maison/)).toBeInTheDocument();
    expect(screen.getByText("€30.00")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("pages with the server's cursor and does not repeat the first page", async () => {
    const bodies: unknown[] = [];
    stubServer((url, init) => {
      if (url !== "/api/v1/search/transactions") return undefined;
      bodies.push(bodyOf(init));
      const cursor = (bodyOf(init) as { cursor?: string }).cursor;
      return cursor
        ? json({ version: 1, items: [personal("Second")], totalCount: 2, nextCursor: null })
        : json({ version: 1, items: [personal("First")], totalCount: 2, nextCursor: "opaque-1" });
    });
    const user = userEvent.setup();
    renderApp("/transactions");
    await user.click(await screen.findByRole("button", { name: "Show more" }));
    expect(await screen.findByText("Second")).toBeInTheDocument();
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(bodies).toEqual([{ pageSize: 50 }, { pageSize: 50, cursor: "opaque-1" }]);
  });

  it("aborts the request for an older search and ignores its late response", async () => {
    const pending: { signal: AbortSignal | null | undefined; release: (response: Response) => void }[] = [];
    stubServer((url, init) => {
      if (url !== "/api/v1/search/transactions") return undefined;
      const query = (bodyOf(init) as { query?: string }).query;
      if (query === "old") {
        return new Promise<Response>((resolve) => pending.push({ signal: init?.signal, release: resolve }));
      }
      return json({ version: 1, items: [personal("New result")], totalCount: 1, nextCursor: null });
    });
    const user = userEvent.setup();
    renderApp("/transactions?q=old");
    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    const box = screen.getByRole("searchbox", { name: "Search transactions" });
    await user.clear(box);
    await user.type(box, "new{Enter}");
    expect(await screen.findByText("New result")).toBeInTheDocument();
    expect(pending[0]?.signal?.aborted).toBe(true);
    pending[0]?.release(json({ version: 1, items: [personal("Old result")], totalCount: 1, nextCursor: null }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("Old result")).not.toBeInTheDocument();
    expect(screen.getByText("New result")).toBeInTheDocument();
  });

  it.each([
    [404, /doesn't offer full search/],
    [429, /Too many searches/],
    [503, /Search is busy/],
  ])("explains a %i response and can retry", async (status, message) => {
    let failing = true;
    stubServer((url) => {
      if (url !== "/api/v1/search/transactions") return undefined;
      return failing ? json({ error: "nope" }, status) : json({ ...emptySearch, items: [personal("Back")], totalCount: 1 });
    });
    const user = userEvent.setup();
    renderApp("/transactions");
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    failing = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Back")).toBeInTheDocument();
  });

  it("refetches the on-screen search when a ledger change invalidates it", async () => {
    let title = "Before";
    const fetchMock = stubServer((url) =>
      url === "/api/v1/search/transactions" ? json({ version: 1, items: [personal(title)], totalCount: 1, nextCursor: null }) : undefined,
    );
    const { queryClient } = renderApp("/transactions");
    expect(await screen.findByText("Before")).toBeInTheDocument();
    title = "After";
    await invalidateSearch(queryClient, ALEX);
    expect(await screen.findByText("After")).toBeInTheDocument();
    expect(callsTo(fetchMock, "/api/v1/search/transactions")).toHaveLength(2);
    // Another account's search results are not invalidated or refetched.
    await invalidateSearch(queryClient, "bob@example.test");
    expect(callsTo(fetchMock, "/api/v1/search/transactions")).toHaveLength(2);
  });
});
