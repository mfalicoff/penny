import { onlineManager } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPrivateData } from "../src/auth/lifecycle";
import { openIndexedDb } from "../src/offline/database";
import { legacyLedgerKey } from "../src/offline/legacy";
import { accountScope, RECORD_FORMAT, recordKey, type LedgerRecord } from "../src/offline/record";
import { ALEX, bodyOf, callsTo, emptySearch, emptyWireLedger, json, openSignOut, renderApp, stubServer, wasCalled } from "./render";

/**
 * The durable offline store inside the real app (router, Query, AuthGate) over IndexedDB
 * (fake-indexeddb, fresh per test). Synthetic data only.
 */
const entry = (id: string, title: string) => ({ id, title, kind: "expense", total: 1200, share: 1200, categoryId: "groceries", date: "2026-11-02", note: "" });
const key = () => recordKey(accountScope(window.location.origin, ALEX));

async function seed(record: Partial<LedgerRecord> & Pick<LedgerRecord, "base" | "local">) {
  const db = await openIndexedDb();
  const value: LedgerRecord = {
    format: RECORD_FORMAT,
    server: window.location.origin,
    email: ALEX,
    baseRevision: 3,
    lastSyncedAt: "2026-11-09T10:00:00.000Z",
    savedAt: "2026-11-09T10:00:00.000Z",
    ...record,
  };
  await db.update(key(), () => ({ next: value, result: null }));
  db.close();
}

async function stored(): Promise<LedgerRecord | undefined> {
  const db = await openIndexedDb();
  const value = (await db.get(key())) as LedgerRecord | undefined;
  db.close();
  return value;
}

/** `GET`/`PUT /api/ledger` with revision checks, plus a switch that makes the server unreachable. */
function ledgerServer(initial: { transactions?: object[] } = {}, searchItems: () => object[] = () => []) {
  const state = { revision: 3, ledger: { ...emptyWireLedger(), ...initial } as Record<string, unknown>, down: false, status: 0 };
  const fetchMock = stubServer((url, init) => {
    if (url === "/api/ledger") {
      if (state.down) throw new TypeError("Failed to fetch");
      if (state.status) return json({ error: "Your session ended." }, state.status);
      if (init?.method === "PUT") {
        const body = bodyOf(init) as { revision: number; ledger: Record<string, unknown> };
        if (body.revision !== state.revision) return json({ error: "The ledger changed." }, 409);
        state.revision += 1;
        state.ledger = body.ledger;
      }
      return json({ revision: state.revision, ledger: state.ledger });
    }
    if (url === "/api/auth/logout") return json({ ok: true });
    if (url === "/api/v1/search/transactions") {
      if (state.down) throw new TypeError("Failed to fetch");
      const items = searchItems();
      return json({ ...emptySearch, items, totalCount: items.length });
    }
    return undefined;
  });
  return { state, fetchMock };
}

function setOnline(value: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);
  act(() => {
    window.dispatchEvent(new Event(value ? "online" : "offline"));
  });
}

afterEach(() => {
  localStorage.clear();
  // Query pauses requests while the browser reports offline; never let that leak into the next test.
  onlineManager.setOnline(true);
});

describe("durable offline ledger in the app", () => {
  it("shows changes waiting from an earlier visit, offline, and syncs them on Retry", async () => {
    const base = { ...emptyWireLedger(), transactions: [entry("a", "Rent")] };
    await seed({ base: base as never, local: { ...base, transactions: [entry("a", "Rent"), entry("b", "Bakery")] } as never });
    const server = ledgerServer({ transactions: [entry("a", "Rent")] });
    server.state.down = true;
    const user = userEvent.setup();
    renderApp("/");
    // Online but the server can't be reached: the banner adds what is waiting to the shell's own.
    await screen.findByText("Not synced · 1 change waiting");
    setOnline(false);
    const banner = await screen.findByText("Offline · 1 change waiting");
    expect(banner.closest(".pk-banner")).toHaveTextContent("saved in this browser");

    server.state.down = false;
    setOnline(true);
    await waitFor(() => {
      expect(screen.queryByText(/change waiting/)).not.toBeInTheDocument();
    });
    const put = callsTo(server.fetchMock, "/api/ledger").find((init) => init?.method === "PUT");
    expect((bodyOf(put) as { ledger: { transactions: { title: string }[] } }).ledger.transactions.map((item) => item.title)).toEqual(["Rent", "Bakery"]);
    expect((await stored())?.baseRevision).toBe(4);

    // Retry after a failure runs a fresh sync.
    server.state.down = true;
    await seed({ base: server.state.ledger as never, local: { ...server.state.ledger, currency: "EUR" } as never, baseRevision: 4 });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const retry = within((await screen.findByText("Not synced · 1 change waiting")).closest(".pk-banner") as HTMLElement).getByRole("button", { name: "Retry" });
    server.state.down = false;
    await user.click(retry);
    await waitFor(() => {
      expect(server.state.ledger.currency).toBe("EUR");
    });
  });

  it("refuses sign-out while the browser holds unsynced changes, and removes the copy once they synced", async () => {
    const base = emptyWireLedger();
    await seed({ base: base as never, local: { ...base, transactions: [entry("b", "Bakery")] } as never });
    const server = ledgerServer();
    server.state.down = true;
    const user = userEvent.setup();
    renderApp("/settings");
    await screen.findByText("Not synced · 1 change waiting");
    await openSignOut(user);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sign out" }));
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("Your changes are still waiting to sync");
    expect(wasCalled(server.fetchMock, "/api/auth/logout")).toBe(false);

    server.state.down = false;
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await user.click(within(screen.getByText("Not synced · 1 change waiting").closest(".pk-banner") as HTMLElement).getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.queryByText(/change waiting/)).not.toBeInTheDocument();
    });
    await openSignOut(user);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sign out" }));
    await waitFor(() => {
      expect(wasCalled(server.fetchMock, "/api/auth/logout")).toBe(true);
    });
    await waitFor(async () => {
      expect(await stored()).toBeUndefined();
    });
  });

  it("searches this browser's ledger while changes are pending, then the server once they synced", async () => {
    const base = { ...emptyWireLedger(), transactions: [entry("a", "Coffee beans"), entry("d", "Coffee to delete")] };
    await seed({ base: base as never, local: { ...base, transactions: [entry("a", "Coffee beans"), entry("c", "Coffee with Mira")] } as never });
    // The server still has the row deleted here, and doesn't have the new one yet.
    const server = ledgerServer({ transactions: base.transactions }, () =>
      (server.state.ledger.transactions as { id: string; title: string }[]).map((item) => ({
        key: `personal:${item.id}`,
        source: "personal",
        match: "title",
        entry: entry(item.id, item.title),
      })),
    );
    server.state.down = true;
    renderApp("/transactions?q=coffee");
    expect(await screen.findByText("2 matching transactions on this device")).toBeInTheDocument();
    const results = screen.getByRole("region", { name: "Search results" });
    expect(within(results).getByText("Coffee with Mira").closest("li")).toHaveTextContent("Waiting to sync");
    expect(within(results).queryByText("Coffee to delete")).not.toBeInTheDocument();

    server.state.down = false;
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(await screen.findByText("2 matching transactions")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Search results" })).queryByText("Coffee to delete")).not.toBeInTheDocument();
    expect(screen.getAllByText("Coffee with Mira")).toHaveLength(1);
  });

  it("keeps durable work when Query's cache is cleared", async () => {
    const base = emptyWireLedger();
    await seed({ base: base as never, local: { ...base, transactions: [entry("b", "Bakery")] } as never });
    const server = ledgerServer();
    server.state.down = true;
    const { queryClient } = renderApp("/");
    await screen.findByText("Not synced · 1 change waiting");
    act(() => {
      clearPrivateData(queryClient);
    });
    await queryClient.refetchQueries();
    expect((await stored())?.local.transactions).toHaveLength(1);
    expect(screen.getByText("Not synced · 1 change waiting")).toBeInTheDocument();
  });

  it("returns to sign-in on 401 and keeps the unsynced changes for the same account", async () => {
    const base = emptyWireLedger();
    await seed({ base: base as never, local: { ...base, transactions: [entry("b", "Bakery")] } as never });
    const server = ledgerServer();
    server.state.status = 401;
    renderApp("/");
    expect(await screen.findByText(/Your session ended/)).toBeInTheDocument();
    expect((await stored())?.local.transactions).toHaveLength(1);
  });

  it("imports the legacy Expo web copy and removes it once its edits reached the server", async () => {
    const base = { ...emptyWireLedger(), transactions: [entry("a", "Rent")] };
    localStorage.setItem(legacyLedgerKey(ALEX), JSON.stringify({ base, local: { ...base, transactions: [entry("a", "Rent"), entry("b", "Bakery")] } }));
    const server = ledgerServer({ transactions: [entry("a", "Rent")] });
    renderApp("/");
    await waitFor(() => {
      expect(localStorage.getItem(legacyLedgerKey(ALEX))).toBeNull();
    });
    expect((server.state.ledger.transactions as { title: string }[]).map((item) => item.title)).toEqual(["Rent", "Bakery"]);
    expect((await stored())?.legacy?.removedAt).toEqual(expect.any(String));
  });

  it("says when the browser blocks storage, and still shows the server's ledger", async () => {
    Reflect.deleteProperty(globalThis, "indexedDB");
    ledgerServer();
    renderApp("/");
    expect(await screen.findByText("This browser isn't keeping Penny's data")).toBeInTheDocument();
  });
});
