import { screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ledger } from "@domain/ledger.ts";
import { openIndexedDb } from "../src/offline/database";
import { accountScope, RECORD_FORMAT, recordKey, type LedgerRecord } from "../src/offline/record";
import { createHouseholdServer, type HouseholdServer } from "./fakes/householdServer";
import { ALEX, bodyOf, callsTo, json, renderApp, stubServer } from "./render";

// Synthetic accounts and amounts only.
const BEA = "bea@example.test";
const CAM = "cam@example.test";

let server: HouseholdServer;

/** Routes /api/ledger and /api/households… to the fake as Alex; everything else as the usual signed-in stub. */
function serve(options: { offline?: () => boolean; unreachable?: (method: string, url: string) => boolean } = {}) {
  return stubServer((url, init) => {
    if (!url.startsWith("/api/households") && url !== "/api/ledger") return undefined;
    if (options.offline?.() || options.unreachable?.(init?.method ?? "GET", url)) throw new TypeError("Failed to fetch");
    const result = server.handle(ALEX, init?.method ?? "GET", url, (bodyOf(init) ?? {}) as Record<string, unknown>);
    return json(result.body, result.status);
  });
}

/** Maison with Alex (creator), Bea and Cam, all joined on 2026-09-01. */
function seed() {
  const now = Date.now();
  vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));
  const household = server.handle(ALEX, "POST", "/api/households", { name: "Maison", currency: "CAD" }).body as { household: { id: string } };
  const id = household.household.id;
  const invite = server.handle(ALEX, "POST", `/api/households/${id}/invites`).body as { code: string };
  server.handle(BEA, "POST", "/api/households/join", { code: invite.code });
  server.handle(CAM, "POST", "/api/households/join", { code: invite.code });
  vi.setSystemTime(now);
  return id;
}

const ids = () => ({ alex: server.userId(ALEX), bea: server.userId(BEA), cam: server.userId(CAM) });

function addExpense(email: string, id: string, input: Record<string, unknown>) {
  const result = server.handle(email, "POST", `/api/households/${id}/expenses`, {
    category: { name: "Home", icon: "home", color: "#C27C4E" },
    splitMode: "equal",
    date: "2026-10-05",
    ...input,
  });
  return (result.body as { expense: { id: string; revision: number } }).expense;
}

const dialog = (name: string | RegExp) => screen.findByRole("dialog", { name });

async function fillExpense(user: UserEvent, form: HTMLElement, title: string, amount: string) {
  await user.type(within(form).getByLabelText("Title"), title);
  await user.type(within(form).getByLabelText(/^Total/), amount);
  await user.clear(within(form).getByLabelText("Date"));
  await user.type(within(form).getByLabelText("Date"), "2026-10-05");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
  server = createHouseholdServer();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("shared list, create and join", () => {
  it("creates a household in the ledger currency and opens People to invite", async () => {
    const fetchMock = serve();
    const user = userEvent.setup();
    const { router } = renderApp("/households");
    expect(await screen.findByRole("heading", { name: "Nothing shared yet" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /New household/ }));
    const form = await dialog("New household");
    expect(within(form).getByText(/Everyone who joins must use CAD too/)).toBeInTheDocument();

    // Validation keeps focus on the field and sends nothing.
    await user.click(within(form).getByRole("button", { name: "Create household" }));
    expect(within(form).getByLabelText("Name")).toHaveFocus();
    expect(callsTo(fetchMock, "/api/households").filter((init) => init?.method === "POST")).toHaveLength(0);

    await user.type(within(form).getByLabelText("Name"), "Maison");
    await user.click(within(form).getByRole("button", { name: "Create household" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Maison" })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ tab: "people" });
    expect(screen.getByText("Maison created")).toBeInTheDocument();
    expect(bodyOf(callsTo(fetchMock, "/api/households").find((init) => init?.method === "POST"))).toMatchObject({ name: "Maison", currency: "CAD" });
    expect(screen.getByRole("button", { name: "Create invite code" })).toBeInTheDocument();
  });

  it("explains an expired invite code, keeps it in the field, then joins with a live one", async () => {
    const id = server.handle(BEA, "POST", "/api/households", { name: "Bea's flat", currency: "CAD" }).body as { household: { id: string } };
    const old = server.handle(BEA, "POST", `/api/households/${id.household.id}/invites`).body as { code: string };
    server.expireInvites();
    serve();
    const user = userEvent.setup();
    renderApp("/households");
    await user.click(await screen.findByRole("button", { name: /Join with a code/ }));
    const form = await dialog("Join a household");
    const field = within(form).getByLabelText("Invite code");

    await user.type(field, "12");
    await user.click(within(form).getByRole("button", { name: "Join household" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("An invite code is 10 letters and numbers");

    await user.clear(field);
    await user.type(field, old.code.toLowerCase());
    await user.click(within(form).getByRole("button", { name: "Join household" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Invite code is invalid or expired.");
    expect(field).toHaveValue(old.code.toLowerCase());
    expect(field).toHaveFocus();

    const live = server.handle(BEA, "POST", `/api/households/${id.household.id}/invites`).body as { code: string };
    await user.clear(field);
    await user.type(field, `${live.code.slice(0, 5)} ${live.code.slice(5)}`);
    await user.click(within(form).getByRole("button", { name: "Join household" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Bea's flat" })).toBeInTheDocument();
    expect(screen.getByText("You joined Bea's flat")).toBeInTheDocument();
  });

  it("lists households with this month's balance and an overdue badge", async () => {
    const id = seed();
    addExpense(ALEX, id, { title: "Hydro", totalCents: 9000, payerUserId: ids().alex });
    addExpense(BEA, id, { title: "Old rent", totalCents: 3000, payerUserId: ids().bea, date: "2026-09-10" });
    serve();
    renderApp("/households");
    const row = await screen.findByRole("link", { name: /Maison/ });
    await waitFor(() => {
      expect(row).toHaveTextContent("October · you're owed $60.00");
    });
    expect(within(row).getByText("Overdue")).toBeInTheDocument();
  });
});

describe("shared expense form", () => {
  it("previews an equal split with remainder cents and sends it", async () => {
    const id = seed();
    const fetchMock = serve();
    const user = userEvent.setup();
    renderApp(`/households/${id}`);
    await user.click(await screen.findByRole("button", { name: "Shared expense" }));
    const form = await dialog("New shared expense");
    await fillExpense(user, form, "Groceries run", "100");
    const shares = within(form).getByRole("list", { name: "Shares" });
    const rows = within(shares).getAllByRole("listitem").map((row) => row.textContent);
    expect(rows).toEqual([expect.stringContaining("$33.34"), expect.stringContaining("$33.33"), expect.stringContaining("$33.33")]);
    expect(within(form).getByText("Your share · in your spending").parentElement).toHaveTextContent("$33.34");

    await user.click(within(form).getByRole("button", { name: "Add expense" }));
    expect(await screen.findByText("Groceries run added")).toBeInTheDocument();
    const post = callsTo(fetchMock, `/api/households/${id}/expenses`).find((init) => init?.method === "POST");
    expect(bodyOf(post)).toMatchObject({ title: "Groceries run", totalCents: 10000, splitMode: "equal", date: "2026-10-05", payerUserId: ids().alex });
    expect(bodyOf(post)).not.toHaveProperty("allocations");
    // The list refetched after the write.
    expect(await screen.findByRole("link", { name: /Groceries run/ })).toBeInTheDocument();
  });

  it("refuses exact shares that don't add up, focusing the split, then saves the corrected amounts", async () => {
    const id = seed();
    const fetchMock = serve();
    const user = userEvent.setup();
    renderApp(`/households/${id}`);
    await user.click(await screen.findByRole("button", { name: "Shared expense" }));
    const form = await dialog("New shared expense");
    await fillExpense(user, form, "Internet", "90");
    await user.click(within(form).getByRole("radio", { name: "Amounts" }));
    await user.type(within(form).getByLabelText("Your share in CAD"), "50");
    await user.type(within(form).getByLabelText(`${BEA}'s share in CAD`), "20");
    await user.type(within(form).getByLabelText(`${CAM}'s share in CAD`), "10");
    expect(within(form).getByText("$10.00 left to assign of $90.00.")).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "Add expense" }));
    expect(within(form).getByText(/Shares must add up to \$90.00/)).toBeInTheDocument();
    expect(within(form).getByLabelText("Your share in CAD")).toHaveFocus();
    expect(callsTo(fetchMock, `/api/households/${id}/expenses`).filter((init) => init?.method === "POST")).toHaveLength(0);

    await user.clear(within(form).getByLabelText(`${CAM}'s share in CAD`));
    await user.type(within(form).getByLabelText(`${CAM}'s share in CAD`), "20");
    await user.click(within(form).getByRole("button", { name: "Add expense" }));
    expect(await screen.findByText("Internet added")).toBeInTheDocument();
    const post = callsTo(fetchMock, `/api/households/${id}/expenses`).find((init) => init?.method === "POST");
    expect(bodyOf(post)).toMatchObject({
      splitMode: "exact",
      allocations: [
        { userId: ids().alex, amountCents: 5000 },
        { userId: ids().bea, amountCents: 2000 },
        { userId: ids().cam, amountCents: 2000 },
      ],
    });
  });

  it("sends percentage splits in basis points and previews the shares", async () => {
    const id = seed();
    const fetchMock = serve();
    const user = userEvent.setup();
    renderApp(`/households/${id}`);
    await user.click(await screen.findByRole("button", { name: "Shared expense" }));
    const form = await dialog("New shared expense");
    await fillExpense(user, form, "Rent", "1000");
    await user.click(within(form).getByRole("radio", { name: "Percent" }));
    await user.type(within(form).getByLabelText("Your share in percent"), "50");
    await user.type(within(form).getByLabelText(`${BEA}'s share in percent`), "33.33");
    expect(within(form).getByText("16.67% left to assign.")).toBeInTheDocument();
    await user.type(within(form).getByLabelText(`${CAM}'s share in percent`), "16.67");
    expect(within(form).getByText("Adds up to 100%.")).toBeInTheDocument();
    expect(within(form).getByText("Your share · in your spending").parentElement).toHaveTextContent("$500.00");
    await user.click(within(form).getByRole("button", { name: "Add expense" }));
    expect(await screen.findByText("Rent added")).toBeInTheDocument();
    expect(bodyOf(callsTo(fetchMock, `/api/households/${id}/expenses`).find((init) => init?.method === "POST"))).toMatchObject({
      splitMode: "percent",
      allocations: [
        { userId: ids().alex, percentBasisPoints: 5000 },
        { userId: ids().bea, percentBasisPoints: 3333 },
        { userId: ids().cam, percentBasisPoints: 1667 },
      ],
    });
  });

  it("offers the payer's private account only to the payer", async () => {
    const id = seed();
    server.setLedger(ALEX, { accounts: [{ id: "acct-visa", name: "Everyday card", type: "credit" }] });
    serve();
    const user = userEvent.setup();
    renderApp(`/households/${id}`);
    await user.click(await screen.findByRole("button", { name: "Shared expense" }));
    const form = await dialog("New shared expense");
    expect(within(form).getByLabelText("Your account")).toHaveAccessibleDescription(/only you see/);
    await user.click(within(form).getByRole("radio", { name: BEA }));
    expect(within(form).queryByLabelText("Your account")).not.toBeInTheDocument();
    expect(within(form).getByText(`${BEA} chooses their own payment account; nobody else sees it.`)).toBeInTheDocument();
  });

  it("offers categories and accounts made on this device, and an unsynced account only once it has synced", async () => {
    const id = seed();
    server.setLedger(ALEX, { accounts: [{ id: "acct-visa", name: "Everyday card", type: "credit" }] });
    // This browser added a category and an account offline; neither reached the server yet.
    const base = (server.handle(ALEX, "GET", "/api/ledger").body as { ledger: Ledger }).ledger;
    const local: Ledger = {
      ...base,
      accounts: [...base.accounts, { id: "acct-cash", name: "Cash jar", type: "cash" }],
      categories: [...base.categories, { id: "c-pets", name: "Pets", icon: "paw", color: "#7A6FB0", kind: "expense" }],
    };
    const db = await openIndexedDb();
    const record: LedgerRecord = { format: RECORD_FORMAT, server: window.location.origin, email: ALEX, baseRevision: 1, base, local, lastSyncedAt: null, savedAt: "2026-10-19T12:00:00.000Z" };
    await db.update(recordKey(accountScope(window.location.origin, ALEX)), () => ({ next: record, result: null }));
    db.close();

    const fetchMock = serve();
    const user = userEvent.setup();
    renderApp(`/households/${id}`);
    await user.click(await screen.findByRole("button", { name: "Shared expense" }));
    const form = await dialog("New shared expense");
    // Categories are sent by value, so one made offline can be used right away.
    expect(await within(form).findByRole("option", { name: "Pets" })).toBeInTheDocument();
    // The server checks the account against its copy of the ledger, so an unsynced one waits.
    expect(within(form).getByRole("option", { name: "Everyday card" })).toBeEnabled();
    expect(within(form).getByRole("option", { name: "Cash jar (waiting to sync)" })).toBeDisabled();
    expect(within(form).getByLabelText("Your account")).toHaveAccessibleDescription(/can be chosen once they've synced/);

    await fillExpense(user, form, "Vet", "60");
    await user.selectOptions(within(form).getByLabelText("Category"), "Pets");
    await user.selectOptions(within(form).getByLabelText("Your account"), "acct-visa");
    await user.click(within(form).getByRole("button", { name: "Add expense" }));
    expect(await screen.findByText("Vet added")).toBeInTheDocument();
    expect(bodyOf(callsTo(fetchMock, `/api/households/${id}/expenses`).find((init) => init?.method === "POST"))).toMatchObject({
      category: { name: "Pets", icon: "paw", color: "#7A6FB0" },
      accountId: "acct-visa",
    });
  });

  it("keeps a stale edit's draft and lets the person keep their changes on the latest version", async () => {
    const id = seed();
    const expense = addExpense(ALEX, id, { title: "Hydro", totalCents: 9000, payerUserId: ids().alex });
    const fetchMock = serve();
    const user = userEvent.setup();
    renderApp(`/households/${id}/expenses/${expense.id}`);
    const detail = await dialog("Hydro");
    await user.click(within(detail).getByRole("button", { name: "Edit" }));
    const form = await dialog("Edit expense");
    const title = within(form).getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Hydro and gas");

    // Bea edits the same expense meanwhile.
    server.handle(BEA, "PUT", `/api/households/${id}/expenses/${expense.id}`, {
      title: "Hydro (October)",
      totalCents: 9300,
      date: "2026-10-05",
      payerUserId: ids().alex,
      splitMode: "equal",
      category: { name: "Home", icon: "home", color: "#C27C4E" },
      revision: 0,
    });
    await user.click(within(form).getByRole("button", { name: "Save" }));
    const banner = await within(form).findByRole("alert");
    expect(banner).toHaveTextContent("Someone else changed this while you were editing");
    expect(banner).toHaveTextContent("Hydro (October), $93.00");
    expect(title).toHaveValue("Hydro and gas");

    await user.click(within(form).getByRole("button", { name: "Keep my changes" }));
    await user.click(within(form).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Changes saved")).toBeInTheDocument();
    const puts = callsTo(fetchMock, `/api/households/${id}/expenses/${expense.id}`).filter((init) => init?.method === "PUT");
    expect(puts.map((init) => (bodyOf(init) as { revision: number }).revision)).toEqual([0, 1]);
  });

  it("creates a repeating expense as a shared rule and pauses it", async () => {
    const id = seed();
    const fetchMock = serve();
    const user = userEvent.setup();
    renderApp(`/households/${id}`);
    await user.click(await screen.findByRole("button", { name: "Shared expense" }));
    const form = await dialog("New shared expense");
    await fillExpense(user, form, "Streaming", "18");
    await user.selectOptions(within(form).getByLabelText("Repeat"), "monthly");
    await user.click(within(form).getByRole("button", { name: "Save repeating expense" }));
    expect(await screen.findByText("Streaming repeats monthly")).toBeInTheDocument();
    expect(bodyOf(callsTo(fetchMock, `/api/households/${id}/recurring`).find((init) => init?.method === "POST"))).toMatchObject({ nextDate: "2026-10-05", frequency: "monthly", totalCents: 1800 });

    const rules = await screen.findByRole("list", { name: "Repeating expenses" });
    expect(rules).toHaveTextContent("Monthly · next");
    await user.click(within(rules).getByRole("button", { name: "Pause Streaming" }));
    expect(await screen.findByText("Streaming paused")).toBeInTheDocument();
    expect(await within(rules).findByText("Paused")).toBeInTheDocument();
  });

  it("keeps the draft and says so when the browser is offline", async () => {
    const id = seed();
    let offline = false;
    serve({ offline: () => offline });
    const user = userEvent.setup();
    renderApp(`/households/${id}`);
    await user.click(await screen.findByRole("button", { name: "Shared expense" }));
    const form = await dialog("New shared expense");
    await fillExpense(user, form, "Plants", "12");
    offline = true;
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await user.click(within(form).getByRole("button", { name: "Add expense" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("You're offline. Shared households need a connection, so nothing was sent. Your changes are still here.");
    expect(within(form).getByLabelText("Title")).toHaveValue("Plants");

    offline = false;
    online.mockReturnValue(true);
    await user.click(within(form).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Plants added")).toBeInTheDocument();
  });
});

describe("payments and settlement", () => {
  it("records a share payment that documents an existing transfer", async () => {
    const id = seed();
    const expense = addExpense(ALEX, id, { title: "Costco run", totalCents: 18420, payerUserId: ids().alex });
    const fetchMock = serve();
    const user = userEvent.setup();
    renderApp(`/households/${id}/expenses/${expense.id}`);
    const detail = await dialog("Costco run");
    expect(within(detail).getByText("Your share · in your spending").parentElement).toHaveTextContent("$61.40");
    await user.click(within(detail).getByRole("button", { name: `Mark ${BEA}'s share as paid` }));
    expect(within(detail).getByText(/Penny keeps track; it doesn't send money, and nobody's spending changes/)).toBeInTheDocument();
    await user.click(within(detail).getByRole("button", { name: "Mark $61.40 as paid" }));
    expect(await screen.findByText("Share marked as paid")).toBeInTheDocument();
    expect(bodyOf(callsTo(fetchMock, `/api/households/${id}/expenses/${expense.id}/payments`)[0])).toEqual({ fromUserId: ids().bea, revision: 0 });
    expect(await within(detail).findByText("Repaid")).toBeInTheDocument();
    // Focus returns to the expense, inside the dialog, so Escape and Tab keep working.
    expect(within(detail).getByRole("heading", { name: "Costco run details" })).toHaveFocus();
    // A paid expense can no longer be deleted.
    expect(within(detail).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("shows the payment-changed state when the expense was edited after opening, and records nothing", async () => {
    const id = seed();
    const expense = addExpense(BEA, id, { title: "Hydro", totalCents: 9630, payerUserId: ids().bea });
    const fetchMock = serve();
    const user = userEvent.setup();
    renderApp(`/households/${id}/expenses/${expense.id}`);
    const detail = await dialog("Hydro");
    await user.click(within(detail).getByRole("button", { name: "Mark your share as paid" }));
    server.handle(BEA, "PUT", `/api/households/${id}/expenses/${expense.id}`, {
      title: "Hydro",
      totalCents: 10410,
      date: "2026-10-05",
      payerUserId: ids().bea,
      splitMode: "equal",
      category: { name: "Home", icon: "home", color: "#C27C4E" },
      revision: 0,
    });
    await user.click(within(detail).getByRole("button", { name: "Mark $32.10 as paid" }));
    const stale = await within(detail).findByRole("alert");
    expect(stale).toHaveTextContent("Hydro changed");
    expect(stale).toHaveTextContent(`${BEA} edited this expense after you opened it`);
    expect(within(stale).getByRole("row", { name: /Total/ })).toHaveTextContent("$96.30$104.10");
    expect(within(stale).getByRole("row", { name: /Your share/ })).toHaveTextContent("$32.10$34.70");
    expect(stale).toHaveTextContent("Nothing was recorded.");
    expect(stale).toHaveFocus();
    expect(within(stale).queryByRole("button", { name: /Mark/ })).not.toBeInTheDocument();
    expect(server.state.reimbursements).toHaveLength(0);
    expect(callsTo(fetchMock, `/api/households/${id}/expenses/${expense.id}/payments`)).toHaveLength(1);

    await user.click(within(stale).getByRole("button", { name: "Review expense" }));
    expect(within(detail).getByText("Your share · in your spending").parentElement).toHaveTextContent("$34.70");
  });

  it("opens monthly payments on the last day and handles a repeated payment as stale", async () => {
    const id = seed();
    addExpense(BEA, id, { title: "Hydro", totalCents: 9000, payerUserId: ids().bea });
    serve();
    const user = userEvent.setup();
    const { unmount } = renderApp(`/households/${id}?tab=balances`);
    const card = await screen.findByRole("region", { name: "October 2026" });
    expect(within(card).getByText(/Monthly payments open on the last day of the month/)).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /Record that/ })).not.toBeInTheDocument();
    unmount();

    vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
    renderApp(`/households/${id}?tab=balances`);
    const open = await screen.findByRole("region", { name: "October 2026" });
    await user.click(within(open).getByRole("button", { name: `Record that You paid ${BEA} $30.00` }));
    const record = await dialog("Record payment");
    expect(record).toHaveTextContent("Penny keeps track; it doesn't send money");
    // Cam records the same transfer from another device first? No: Bea records Alex's payment first.
    server.handle(BEA, "POST", `/api/households/${id}/months/2026-10/reimbursements`, { fromUserId: ids().alex, toUserId: ids().bea, amountCents: 3000 });
    await user.click(within(record).getByRole("button", { name: "Mark $30.00 as paid" }));
    const stale = await dialog("Balance changed");
    expect(stale).toHaveTextContent("Nothing was recorded.");
    expect(within(stale).getByRole("row", { name: /Amount/ })).toHaveTextContent("Nothing to pay");
    expect(server.state.reimbursements).toHaveLength(1);
  });

  it("says the balance changed when the month can't be re-read after a stale payment, and records nothing", async () => {
    vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
    const id = seed();
    addExpense(BEA, id, { title: "Hydro", totalCents: 9000, payerUserId: ids().bea });
    let monthDown = false;
    serve({ unreachable: (method, url) => monthDown && method === "GET" && url.includes("/months/") });
    const user = userEvent.setup();
    renderApp(`/households/${id}?tab=balances`);
    const open = await screen.findByRole("region", { name: "October 2026" });
    await user.click(within(open).getByRole("button", { name: `Record that You paid ${BEA} $30.00` }));
    const record = await dialog("Record payment");
    server.handle(BEA, "POST", `/api/households/${id}/months/2026-10/reimbursements`, { fromUserId: ids().alex, toUserId: ids().bea, amountCents: 3000 });
    monthDown = true;
    await user.click(within(record).getByRole("button", { name: "Mark $30.00 as paid" }));
    const alert = await within(record).findByRole("alert");
    expect(alert).toHaveTextContent("October 2026 changed after you opened this payment, so nothing was recorded.");
    expect(alert).toHaveTextContent("Penny couldn't load the new balance either: Penny can't reach the server.");
    expect(screen.queryByRole("dialog", { name: "Balance changed" })).not.toBeInTheDocument();
    expect(server.state.reimbursements).toHaveLength(1);

    // Once the month loads again, trying again shows the new balance.
    monthDown = false;
    await user.click(within(record).getByRole("button", { name: "Mark $30.00 as paid" }));
    expect(within(await dialog("Balance changed")).getByRole("row", { name: /Amount/ })).toHaveTextContent("Nothing to pay");
    expect(server.state.reimbursements).toHaveLength(1);
  });

  it("refuses to leave with an unsettled month and keeps the dialog open with the reason", async () => {
    const id = server.handle(BEA, "POST", "/api/households", { name: "Bea's flat", currency: "CAD" }).body as { household: { id: string } };
    const invite = server.handle(BEA, "POST", `/api/households/${id.household.id}/invites`).body as { code: string };
    server.handle(ALEX, "POST", "/api/households/join", { code: invite.code });
    addExpense(BEA, id.household.id, { title: "Hydro", totalCents: 9000, payerUserId: server.userId(BEA), date: "2026-10-20" });
    serve();
    const user = userEvent.setup();
    renderApp(`/households/${id.household.id}?tab=people`);
    await user.click(await screen.findByRole("button", { name: "Leave household" }));
    const confirm = await dialog("Leave Bea's flat?");
    await user.click(within(confirm).getByRole("button", { name: "Leave" }));
    expect(await within(confirm).findByRole("alert")).toHaveTextContent("Settle every monthly balance before leaving.");
    expect(screen.getByRole("heading", { level: 1, name: "Bea's flat" })).toBeInTheDocument();
  });

  it("names the unsettled months before archiving and shows the server's refusal", async () => {
    const id = seed();
    addExpense(BEA, id, { title: "Hydro", totalCents: 9000, payerUserId: ids().bea });
    serve();
    const user = userEvent.setup();
    renderApp(`/households/${id}?tab=people`);
    await user.click(await screen.findByRole("button", { name: "Archive household" }));
    const confirm = await dialog("Archive Maison?");
    expect(confirm).toHaveTextContent("Still unsettled: October 2026");
    await user.click(within(confirm).getByRole("button", { name: "Archive" }));
    expect(await within(confirm).findByRole("alert")).toHaveTextContent("Settle all monthly balances before archiving.");
  });

  it("shows an archived household read-only", async () => {
    const id = seed();
    server.handle(ALEX, "POST", `/api/households/${id}/archive`);
    serve();
    renderApp(`/households/${id}`);
    expect(await screen.findByText("This household is archived")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Shared expense" })).not.toBeInTheDocument();
  });
});

describe("people, invites and history", () => {
  it("creates an invite code with its countdown and removes a settled member", async () => {
    const id = seed();
    serve();
    const user = userEvent.setup();
    renderApp(`/households/${id}?tab=people`);
    await user.click(await screen.findByRole("button", { name: "Create invite code" }));
    const code = server.state.invites[0]?.code ?? "";
    expect(await screen.findByLabelText(`Invite code ${code.split("").join(" ")}`)).toBeInTheDocument();
    expect(screen.getByText(/Expires in 10:00|Expires in 9:5\d/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: `Remove ${CAM}` }));
    const confirm = await dialog(`Remove ${CAM}?`);
    await user.click(within(confirm).getByRole("button", { name: "Remove member" }));
    expect(await screen.findByText(`${CAM} was removed`)).toBeInTheDocument();
    expect(await screen.findByRole("list", { name: "Former members" })).toHaveTextContent(CAM);
  });

  it("filters the household history and never shows a payer's account", async () => {
    const id = seed();
    server.setLedger(BEA, { accounts: [{ id: "acct-bea", name: "Bea's private card", type: "credit" }] });
    const expense = addExpense(BEA, id, { title: "Hydro", totalCents: 9000, payerUserId: ids().bea, accountId: "acct-bea" });
    server.handle(ALEX, "POST", `/api/households/${id}/expenses/${expense.id}/payments`, { fromUserId: ids().alex, revision: 0 });
    serve();
    const user = userEvent.setup();
    renderApp(`/households/${id}?tab=history`);
    const history = await screen.findByRole("region", { name: "History" });
    expect(history).toHaveTextContent(`${BEA} added Hydro`);
    expect(history).toHaveTextContent(`${BEA} joined`);
    await user.click(within(history).getByRole("radio", { name: "Payments" }));
    expect(history).toHaveTextContent("You recorded your $30.00 share payment");
    expect(history).not.toHaveTextContent("added Hydro");
    expect(document.body).not.toHaveTextContent("Bea's private card");
    expect(document.body).not.toHaveTextContent("acct-bea");
  });

  it("says a household is unavailable instead of failing", async () => {
    serve();
    renderApp("/households/h-unknown");
    expect(await screen.findByText(/This household isn't available to you/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Household" })).toBeInTheDocument();
  });
});
