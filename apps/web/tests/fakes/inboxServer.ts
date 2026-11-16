import { bodyOf, json } from "../render";
import { ledgerServer, type Ledger } from "./ledgerServer";

/**
 * Emailed receipts (MAZ-184) on top of the ledger fake: `GET/POST/PATCH/DELETE /api/receipt-email`,
 * `GET /api/receipt-inbox`, Discard and Done, receipt bytes, and one shared expense
 * (`/api/households/h1/expenses/s1`, revision-checked). Like the server, a ledger save or shared
 * expense save that links an inbox file moves its item. Synthetic data only.
 */

export const hex = (n: number) => n.toString(16).padStart(32, "0");

export interface FakeFile {
  receiptId: string;
  kind: "email" | "attachment";
  name: string;
  mime: string;
  sizeBytes: number;
  linked: boolean;
  uri: string;
}

export interface FakeItem {
  id: string;
  from: string;
  subject: string;
  receivedAt: number;
  status: "to_attach" | "partly_attached" | "attached";
  senderVerified: boolean;
  expiresAt: number | null;
  attachedAt: number | null;
  files: FakeFile[];
}

export const inboxFile = (receiptId: string, kind: FakeFile["kind"], name: string, extra: Partial<FakeFile> = {}): FakeFile => ({
  receiptId,
  kind,
  name,
  mime: "application/pdf",
  sizeBytes: 2048,
  linked: false,
  uri: `/api/receipts/${receiptId}`,
  ...extra,
});

/** Local noon on a day, so the received day is the same in every time zone the tests run in. */
export const localNoon = (day: string) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), 12).getTime();

export const inboxItem = (n: number, extra: Partial<FakeItem> = {}): FakeItem => ({
  id: hex(n),
  from: `"Acme Store" <billing@acme.example>`,
  subject: `Order ${String(n)}`,
  receivedAt: localNoon("2026-11-12"),
  status: "to_attach",
  senderVerified: true,
  expiresAt: Date.now() + 20 * 86_400_000,
  attachedAt: null,
  files: [inboxFile(`email${String(n)}`, "email", "Email PDF"), inboxFile(`inv${String(n)}`, "attachment", `invoice-${String(n)}.pdf`)],
  ...extra,
});

export const ADDRESS = {
  address: "r-abcdefghijklmnopqrst@receipts.example",
  createdAt: Date.parse("2026-11-01T12:00:00Z"),
  expiresAt: Date.parse("2027-01-30T12:00:00Z"),
  lastReceivedAt: null,
  allowedSenders: [] as string[],
};

export interface SharedFake {
  id: string;
  householdId: string;
  title: string;
  totalCents: number;
  date: string;
  revision: number;
  receiptId?: string;
  receipt?: { id: string; name: string; mime: string; uri: string };
}

export function inboxServer(options: {
  ledger?: Partial<Ledger>;
  enabled?: boolean;
  address?: typeof ADDRESS | null;
  items?: FakeItem[];
  shared?: SharedFake;
  search?: (body: Record<string, unknown>) => object[];
} = {}) {
  const server = ledgerServer(options.ledger ?? {}, options.search ? { search: options.search } : {});
  const state = {
    enabled: options.enabled ?? true,
    address: options.address === undefined ? { ...ADDRESS } : options.address,
    items: options.items ?? [],
    shared: options.shared,
    sharedConflicts: 0,
    created: 0,
    sendersError: null as string | null,
  };
  const envelope = () => ({ enabled: state.enabled, domain: state.enabled ? "receipts.example" : null, address: state.address });

  /** What the server does inside a save: mark files linked or not, and move items between states. */
  function relink(linked: Set<string>) {
    for (const item of state.items) {
      for (const file of item.files) file.linked = linked.has(file.receiptId);
      const count = item.files.filter((file) => file.linked).length;
      if (item.status === "attached" && item.attachedAt && count > 0) continue;
      item.status = count === 0 ? "to_attach" : count === item.files.length ? "attached" : "partly_attached";
      item.attachedAt = item.status === "attached" ? Date.now() : null;
    }
  }
  const linkedIds = () => {
    const ids = new Set<string>();
    for (const entry of server.state.ledger.transactions as { receipt?: { id: string } }[]) if (entry.receipt) ids.add(entry.receipt.id);
    if (state.shared?.receiptId) ids.add(state.shared.receiptId);
    return ids;
  };

  const base = server.fetchMock.getMockImplementation();
  server.fetchMock.mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const reply = (body: unknown, status = 200) => Promise.resolve(json(body, status));
    if (url === "/api/receipt-email") {
      if (method === "GET") return reply(envelope());
      if (!state.enabled) return reply({ error: "Not found." }, 404);
      if (method === "POST") {
        state.created += 1;
        state.address = { ...ADDRESS, address: `r-${"n".repeat(19)}${String(state.created)}@receipts.example`, allowedSenders: state.address?.allowedSenders ?? [] };
        return reply(envelope(), 201);
      }
      if (method === "PATCH") {
        const body = bodyOf(init) as { extend?: boolean; allowedSenders?: string[] };
        if (!state.address) return reply({ error: "There is no receipt address." }, 404);
        if (body.allowedSenders) {
          if (state.sendersError) return reply({ error: state.sendersError }, 400);
          state.address = { ...state.address, allowedSenders: body.allowedSenders };
        }
        if (body.extend) state.address = { ...state.address, expiresAt: state.address.expiresAt + 30 * 86_400_000 };
        return reply(envelope());
      }
      if (method === "DELETE") {
        state.address = null;
        return reply({ ok: true });
      }
    }
    if (url.startsWith("/api/receipt-inbox")) {
      if (!state.enabled) return reply({ error: "Not found." }, 404);
      const path = url.split("?")[0] ?? "";
      const id = /^\/api\/receipt-inbox\/([0-9a-f]{32})/.exec(path)?.[1];
      if (!id && method === "GET") {
        const status = new URL(url, "http://x").searchParams.get("status") ?? "to_attach";
        const items = state.items
          .filter((item) => (status === "attached" ? item.status === "attached" : item.status !== "attached"))
          .sort((a, b) => b.receivedAt - a.receivedAt);
        return reply({ items, next: null });
      }
      const item = state.items.find((candidate) => candidate.id === id);
      if (!item) return reply({ error: "Inbox item not found." }, 404);
      const kept = item.files.filter((file) => file.linked).length;
      const deleted = item.files.length - kept;
      if (path.endsWith("/done") && method === "POST") {
        item.files = item.files.filter((file) => file.linked);
        item.status = "attached";
        return reply({ deleted, kept });
      }
      if (method === "DELETE") {
        state.items = state.items.filter((candidate) => candidate !== item);
        return reply({ deleted, kept });
      }
    }
    if (url.startsWith("/api/receipts/")) return reply({ error: "Receipt not found." }, 404);
    if (url === "/api/households") return reply({ households: state.shared ? [{ id: "h1", name: "Maison", currency: "CAD", creatorId: "u1", createdAt: 1, memberCount: 2 }] : [] });
    if (state.shared && url === `/api/households/h1/expenses/${state.shared.id}`) {
      const shared = state.shared;
      const view = () => ({
        id: shared.id,
        householdId: "h1",
        title: shared.title,
        totalCents: shared.totalCents,
        payerUserId: "u1",
        splitMode: "equal",
        category: { name: "Groceries", icon: "basket-outline", color: "#6C9C79" },
        note: "",
        date: shared.date,
        splits: [{ userId: "u1", amountCents: shared.totalCents / 2 }, { userId: "u2", amountCents: shared.totalCents / 2 }],
        ...(shared.receipt ? { receipt: shared.receipt, receiptId: shared.receipt.id } : shared.receiptId ? { receiptId: shared.receiptId } : {}),
        revision: shared.revision,
        createdBy: "u1",
        createdAt: 1,
        updatedBy: "u1",
        updatedAt: 1,
        payments: [],
        paymentsClosed: false,
      });
      if (method === "PUT") {
        const body = bodyOf(init) as { revision: number; receiptId?: string };
        if (state.sharedConflicts > 0) {
          state.sharedConflicts -= 1;
          shared.revision += 1;
          shared.title = `${shared.title} (edited)`;
          return reply({ error: "This expense changed. Reload it and try again." }, 409);
        }
        if (body.revision !== shared.revision) return reply({ error: "This expense changed. Reload it and try again." }, 409);
        shared.revision += 1;
        delete shared.receipt;
        if (body.receiptId) shared.receiptId = body.receiptId;
        else delete shared.receiptId;
        relink(linkedIds());
      }
      return reply({ expense: view() });
    }
    if (url === "/api/ledger" && method === "PUT") {
      return (base ? base(input, init) : reply({}, 404)).then((response) => {
        if (response.ok) relink(linkedIds());
        return response;
      });
    }
    return base ? base(input, init) : reply({ error: "Not found." }, 404);
  });
  return { ...server, inbox: state };
}
