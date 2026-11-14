import { initialCategories } from "@domain/ledger.ts";
import type { Transport } from "../api/client";
import type { SearchItem, SearchRequest } from "../api/schemas";

/** The demo account. `.invalid` can never be a real address, so its cache keys never collide. */
export const DEMO_EMAIL = "demo@penny.invalid";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const pad = (value: number) => String(value).padStart(2, "0");
const dateKey = (date: Date) => `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

type Kind = "income" | "expense" | "investment";
interface DemoEntry {
  id: string;
  title: string;
  kind: Kind;
  total: number;
  share: number;
  categoryId: string;
  date: string;
  note: string;
  tripId?: string;
}

/** Sample month: made-up names and amounts, no real data. */
export function sampleEntries(today = new Date()): DemoEntry[] {
  const day = today.getDate();
  const on = (offset: number) => dateKey(new Date(today.getFullYear(), today.getMonth(), Math.max(1, day - offset)));
  const rows: [string, number, string, number, number?, Kind?][] = [
    ["Monthly salary", 480000, "salary", 20, 480000, "income"],
    ["Rent", 145000, "home", 20],
    ["Weekly groceries", 8642, "groceries", 0],
    ["Coffee with a friend", 1240, "food", 0, 620],
    ["Dinner out", 14880, "food", 1, 7440],
    ["Monthly transit pass", 15600, "transport", 5],
    ["A new read", 2499, "shopping", 2],
    ["Weekend groceries", 7235, "groceries", 6],
    ["Design project", 65000, "freelance", 8, 65000, "income"],
    ["Index fund", 20000, "investments", 10, 20000, "investment"],
    ["Music streaming", 1299, "fun", 3],
  ];
  return rows.map(([title, total, categoryId, offset, share = total, kind = "expense"], index) => ({
    id: `demo-${String(index + 1)}`,
    title,
    kind,
    total,
    share,
    categoryId,
    date: on(offset),
    note: "",
  }));
}

/** A made-up personal trip (MAZ-93) starting in 12 days. The demo has no shared trips. */
export function sampleTrips(today = new Date()) {
  const at = (offset: number) => dateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset));
  return [{ id: "demo-trip", name: "Weekend in Québec City", startDate: at(12), endDate: at(14) }];
}

/**
 * Two schedules due on the month's last day (MAZ-92), so the demo's Home shows a projected
 * remaining with expected recurring income and something coming up. Previews only: the demo never
 * records them.
 */
export function sampleSchedules(today = new Date()) {
  const last = dateKey(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  const anchorDay = Number(last.slice(8));
  const rule = (id: string, title: string, kind: Kind, total: number, categoryId: string) => ({
    id, title, kind, total, share: total, categoryId, date: last, note: "", frequency: "monthly", nextDate: last, anchorDay, active: true,
  });
  return [rule("demo-rule-1", "Design retainer", "income", 40000, "freelance"), rule("demo-rule-2", "Phone plan", "expense", 4500, "other")];
}

/**
 * An in-memory stand-in for the parts of the API the web app uses, for the temporary demo. It
 * keeps the API's rules that matter to the UI (revision conflicts, cursor paging) and answers
 * everything else with 404, so a screen that needs a real server says so instead of guessing.
 */
export function createDemoServer(today = new Date()): Transport {
  const state = {
    revision: 1,
    ledger: {
      version: 4,
      currency: "CAD",
      accounts: [],
      trips: sampleTrips(today),
      // The default categories, so the demo's categories have names, colors and icons.
      categories: initialCategories.map((category) => ({ ...category })),
      // Dinner out goes on the sample trip, dated before it: expenses outside the dates still count.
      transactions: sampleEntries(today).map((entry) => (entry.id === "demo-5" ? { ...entry, tripId: "demo-trip" } : entry)),
      recurring: sampleSchedules(today),
    } as Record<string, unknown> & { transactions: DemoEntry[] },
  };

  function search(request: SearchRequest) {
    const query = request.query?.trim().toLowerCase();
    const matches = state.ledger.transactions
      .filter((entry) => !query || entry.title.toLowerCase().includes(query))
      .filter((entry) => (!request.from || entry.date >= request.from) && (!request.to || entry.date <= request.to))
      .filter((entry) => !request.kind || entry.kind === request.kind)
      .filter(() => request.source !== "shared")
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    const start = request.cursor ? Number(request.cursor) : 0;
    const size = request.pageSize ?? 50;
    const page = matches.slice(start, start + size);
    const items: SearchItem[] = page.map((entry) => ({ key: `personal:${entry.id}`, source: "personal", match: query ? "title" : null, entry }));
    const next = start + size < matches.length ? String(start + size) : null;
    return { version: 1, items, totalCount: matches.length, nextCursor: next };
  }

  // Receipts uploaded in the demo (MAZ-94): kept in this tab's memory only, like everything else.
  const receipts = new Map<string, { name: string; mime: string; bytes: Uint8Array<ArrayBuffer> }>();
  function receipt(path: string, method: string, body: unknown): Response | null {
    if (method === "POST" && path === "/api/receipts") {
      const upload = body as { name: string; mime: string; base64: string };
      const id = `demo-receipt-${String(receipts.size + 1)}`;
      receipts.set(id, { name: upload.name, mime: upload.mime, bytes: Uint8Array.from(atob(upload.base64), (character) => character.charCodeAt(0)) });
      return json({ id, name: upload.name, mime: upload.mime, uri: `/api/receipts/${id}` }, 201);
    }
    const stored = method === "GET" && path.startsWith("/api/receipts/") ? receipts.get(path.slice("/api/receipts/".length)) : undefined;
    return stored ? new Response(stored.bytes, { status: 200, headers: { "Content-Type": stored.mime } }) : null;
  }

  return async (path, { method, body, signal }) => {
    // Answer asynchronously, like a network, so loading states and aborts behave the same.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (signal?.aborted) throw new DOMException("The request was aborted.", "AbortError");
    const stored = receipt(path, method, body);
    if (stored) return stored;

    const route = `${method} ${path}`;
    switch (route) {
      case "GET /api/info":
        return json({ name: "penny", version: "demo" });
      case "GET /api/auth/me":
        return json({ email: DEMO_EMAIL });
      case "GET /api/auth/oidc":
        return json({ enabled: false });
      case "POST /api/auth/logout":
        return json({ ok: true });
      case "GET /api/ledger":
        return json(state);
      case "PUT /api/ledger": {
        const next = body as { revision: number; ledger: typeof state.ledger };
        if (next.revision !== state.revision) return json({ error: "The ledger changed." }, 409);
        state.revision += 1;
        state.ledger = next.ledger;
        return json(state);
      }
      case "POST /api/v1/search/transactions":
        return json(search(body as SearchRequest));
      default:
        return json({ error: "This isn't available in the demo." }, 404);
    }
  };
}
