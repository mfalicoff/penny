import { act } from "@testing-library/react";
import { vi } from "vitest";
import { bodyOf, emptySearch, json, stubServer } from "../render";

/**
 * A revision-checked `GET`/`PUT /api/ledger` (409 on a stale write, never a merge), the shared
 * projection and search, for the entry form and Activity tests (MAZ-88). Synthetic data only.
 */
export type WireEntry = { id: string; title: string; kind: string; total: number; share: number; categoryId: string; date: string; note: string; accountId?: string; tripId?: string; recurringId?: string };

export const entry = (id: string, title: string, extra: Partial<WireEntry> = {}): WireEntry => ({
  id,
  title,
  kind: "expense",
  total: 1200,
  share: 1200,
  categoryId: "groceries",
  date: "2026-11-02",
  note: "",
  ...extra,
});

export const richLedger = (extra: Record<string, unknown> = {}) => ({
  version: 4,
  currency: "CAD",
  accounts: [{ id: "chq", name: "Chequing", type: "bank" }],
  trips: [{ id: "lis", name: "Lisbon", startDate: "2026-10-01", endDate: "2026-10-12" }],
  categories: [
    { id: "groceries", name: "Groceries", icon: "basket-outline", color: "#6C9C79", kind: "expense" },
    { id: "food", name: "Food & drinks", icon: "cafe-outline", color: "#E47850", kind: "expense" },
    { id: "salary", name: "Salary", icon: "briefcase-outline", color: "#6C9C79", kind: "income" },
    { id: "investments", name: "Investments", icon: "trending-up-outline", color: "#678DB1", kind: "investment" },
  ],
  transactions: [] as WireEntry[],
  recurring: [] as unknown[],
  ...extra,
});

export type Ledger = ReturnType<typeof richLedger>;

export interface SharedRowInput {
  id: string;
  title: string;
  date: string;
  shareCents: number;
  totalCents?: number;
  category?: string;
}

export const sharedRow = ({ id, title, date, shareCents, totalCents = shareCents * 2, category = "Groceries" }: SharedRowInput) => ({
  id,
  householdId: "h1",
  householdName: "Maison",
  householdCurrency: "CAD",
  title,
  date,
  totalCents,
  shareCents,
  payerUserId: "u2",
  category: { name: category, icon: "basket-outline", color: "#6C9C79" },
  note: "",
});

export function ledgerServer(initial: Partial<Ledger> = {}, options: { shared?: ReturnType<typeof sharedRow>[]; search?: (body: Record<string, unknown>) => object[] } = {}) {
  const state = {
    revision: 3,
    ledger: richLedger(initial),
    down: false,
    puts: 0,
    shared: options.shared ?? [],
    projections: [] as string[],
    searches: [] as Record<string, unknown>[],
  };
  const fetchMock = stubServer((url, init) => {
    if (url === "/api/ledger") {
      if (state.down) throw new TypeError("Failed to fetch");
      if (init?.method === "PUT") {
        const body = bodyOf(init) as { revision: number; ledger: Ledger };
        if (body.revision !== state.revision) return json({ error: "The ledger changed." }, 409);
        state.revision += 1;
        state.puts += 1;
        state.ledger = body.ledger;
      }
      return json({ revision: state.revision, ledger: state.ledger });
    }
    if (url.startsWith("/api/households/projection")) {
      if (state.down) throw new TypeError("Failed to fetch");
      state.projections.push(url);
      const month = /month=([\d-]+)/.exec(url)?.[1];
      const year = /year=(\d+)/.exec(url)?.[1];
      const rows = state.shared.filter((row) => (!month || row.date.startsWith(month)) && (!year || row.date.startsWith(year)));
      return json({ transactions: rows, scheduled: [] });
    }
    if (url === "/api/v1/search/transactions") {
      if (state.down) throw new TypeError("Failed to fetch");
      const body = bodyOf(init) as Record<string, unknown>;
      state.searches.push(body);
      const items = options.search?.(body) ?? [];
      return json({ ...emptySearch, items, totalCount: items.length });
    }
    if (url === "/api/auth/logout") return json({ ok: true });
    return undefined;
  });
  /** Another device writes to the server, as the iOS app would. */
  function otherDevice(change: (ledger: Ledger) => Ledger) {
    state.ledger = change(state.ledger);
    state.revision += 1;
  }
  return { state, fetchMock, otherDevice };
}

export function setOnline(value: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);
  act(() => {
    window.dispatchEvent(new Event(value ? "online" : "offline"));
  });
}

/** Personal search results as the server sends them. */
export const personalHit = (item: WireEntry) => ({ key: `personal:${item.id}`, source: "personal", match: "title", entry: item });
export const sharedHit = (row: ReturnType<typeof sharedRow>) => ({ key: `shared:${row.id}`, source: "shared", match: "title", entry: row });
