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
  await user.type(within(form).getByLabelText("Amount (CAD)"), amount);
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
  vi.unstubAllGlobals();
});

/** A window this wide: `min-width` queries answer for it (jsdom alone lays out for a phone). */
function stubWidth(width: number, touch = false) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      // A mouse and keyboard unless `touch`: then the touch-tablet query (`ipad-shared`) matches too.
      if (query.includes("pointer: coarse") && !touch) return { matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() };
      return { matches: min ? width >= Number(min[1]) : false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    }),
  );
}

const topbar = () => screen.getByRole("banner");

describe("household layout (MAZ-229)", () => {
  it("puts the month, History and Invite in the navigation bar and drops the hero off Expenses", async () => {
    const id = seed();
    serve();
    const user = userEvent.setup();
    renderApp(`/households/${id}`);
    expect(await screen.findByRole("region", { name: "Household summary" })).toHaveTextContent("October · ");
    expect(within(topbar()).getByRole("link", { name: "Back to Shared" })).toHaveAttribute("href", "/households");
    expect(within(topbar()).getByLabelText("Month")).toHaveValue("2026-10");
    // Expenses has Invite and the … menu (card `iphone-shared`); History is in the menu there.
    expect(within(topbar()).queryByRole("link", { name: "History" })).not.toBeInTheDocument();
    expect(within(topbar()).getByRole("link", { name: "Invite" })).toBeInTheDocument();
    await user.click(within(topbar()).getByRole("button", { name: "Household actions" }));
    expect(within(topbar()).getByRole("button", { name: "History" })).toBeInTheDocument();
    expect(within(topbar()).getByRole("button", { name: "Rename" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    // Phones keep Record payment and Shared expense in the hero; no month switcher or Repeating card on the page.
    const summary = screen.getByRole("region", { name: "Household summary" });
    expect(within(summary).getByRole("link", { name: "Record payment" })).toBeInTheDocument();
    expect(within(summary).getByRole("button", { name: "Shared expense" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Month" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Repeating" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Balances" }));
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Household summary" })).not.toBeInTheDocument();
    });
    expect(within(topbar()).getByLabelText("Month")).toBeInTheDocument();

    // Balances collapses to the navigation bar with History and the … menu (card `iphone-shared-balances`).
    expect(within(topbar()).queryByRole("link", { name: "Invite" })).not.toBeInTheDocument();
    await user.click(within(topbar()).getByRole("link", { name: "History" }));
    expect(await screen.findByRole("region", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "History" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Household summary" })).not.toBeInTheDocument();
    expect(within(topbar()).queryByLabelText("Month")).not.toBeInTheDocument();
  });

  it("shows Balances and the selected expense beside the expenses from 1100px", async () => {
    stubWidth(1440);
    const id = seed();
    const { alex } = ids();
    addExpense(ALEX, id, { title: "Hydro", totalCents: 9000, payerUserId: alex });
    serve();
    const user = userEvent.setup();
    renderApp(`/households/${id}`);
    const summary = await screen.findByRole("region", { name: "Household summary" });
    // The add action moves to the navigation bar, beside History and Invite; the top bar's Add entry steps aside.
    expect(within(summary).queryByRole("button", { name: "Shared expense" })).not.toBeInTheDocument();
    expect(within(topbar()).getByRole("button", { name: "Shared expense" })).toBeInTheDocument();
    // The expense table, with Balances beside it, on one page (card `web-household`).
    const table = await screen.findByRole("region", { name: "Expenses in October 2026" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Expense", "Paid by", "Split", "Total", "Your share", "Status"]);
    expect(await screen.findByRole("region", { name: "Balances" })).toBeInTheDocument();
    expect(screen.getByText(/Penny records payments made outside the app/)).toBeInTheDocument();

    await user.click(await screen.findByRole("link", { name: /^Hydro/ }));
    const panel = await screen.findByRole("region", { name: "Hydro" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(within(panel).getByRole("heading", { name: "Hydro" })).toHaveFocus();
    });
    expect(within(panel).getByText("Shares")).toBeInTheDocument();
    // `web-shared-expense`: the open row is marked, the payer is tagged and Paid, and the actions are one row.
    await waitFor(() => {
      expect(within(screen.getByRole("region", { name: "Expenses in October 2026" })).getByRole("link", { name: /^Hydro/ }).closest("tr")).toHaveClass("expense-table__open");
    });
    expect(within(panel).getByText("payer")).toBeInTheDocument();
    expect(within(panel).getByText("Paid")).toBeInTheDocument();
    for (const name of ["Edit", "Change history", "Delete"]) expect(within(panel).getByRole("button", { name })).toBeInTheDocument();
    // Balances under the open expense leaves out the suggested payments and the note; closing brings them back.
    expect(screen.queryByText(/Penny records payments made outside the app/)).not.toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Close Hydro" }));
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Hydro" })).not.toBeInTheDocument();
    });
    expect(await screen.findByText(/Penny records payments made outside the app/)).toBeInTheDocument();
  });
});

describe("household on a touch tablet (ipad-shared)", () => {
  it("splits the hero across the panes, groups the expenses by week and reads the add button + Expense", async () => {
    stubWidth(1194, true);
    const id = seed();
    const { alex, bea } = ids();
    addExpense(ALEX, id, { title: "Hydro", totalCents: 9000, payerUserId: bea, date: "2026-10-18" });
    addExpense(ALEX, id, { title: "Rent", totalCents: 100000, payerUserId: alex, date: "2026-10-02" });
    serve();
    const user = userEvent.setup();
    renderApp(`/households/${id}`);
    // The pane always shows an expense: the first listed one (the URL selects it, so the page settles there first).
    const panel = await screen.findByRole("region", { name: "Hydro" });
    // The expenses pane leads with the name, the members and the month's total.
    const summary = await screen.findByRole("region", { name: "Household summary" });
    expect(summary).toHaveTextContent("Maison");
    expect(await within(summary).findByText("October · $1,090.00 in shared expenses")).toBeInTheDocument();
    expect(within(summary).getByRole("navigation", { name: "Household sections" })).toBeInTheDocument();
    expect(within(summary).queryByText(/you're owed|you owe|you're settled/)).not.toBeInTheDocument();
    // This week and Earlier, as on the card, rather than the desktop table.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(within(await screen.findByRole("list", { name: "This week" })).getByRole("link", { name: /^Hydro/ })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Earlier" })).getByRole("link", { name: /^Rent/ })).toBeInTheDocument();
    // The other pane leads with the viewer's balance, over Balances.
    const balance = screen.getByText(/^October · you're owed/);
    const balances = await screen.findByRole("region", { name: "Balances" });
    expect(balance.compareDocumentPosition(balances) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The bar's add action shows "Expense" and keeps its full name.
    const add = within(topbar()).getByRole("button", { name: "Shared expense" });
    expect(add).toHaveTextContent("Expense");
    expect(add).not.toHaveTextContent("Shared");
    // Balances is the card's: each member's payment on their row, and gets back or owes under the amount.
    const rows = within(balances).getByRole("list", { name: "Balances for October 2026" });
    expect(within(rows).getAllByText(/^pays you \$/)).toHaveLength(2);
    expect(within(rows).getByText("gets back")).toBeVisible();
    expect(within(rows).getAllByText("owes")).toHaveLength(2);
    expect(within(balances).getByText("Record paid opens on the last day of the month. Repay a single expense any time with Mark as paid.")).toBeInTheDocument();
    expect(within(balances).queryByText("Suggested payments")).not.toBeInTheDocument();
    // The selected expense is below Balances, and the page picking it didn't move focus.
    expect(balances.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Close Hydro" })).not.toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: "Hydro" })).not.toHaveFocus();
    // It's the card's short card: who paid what and when, then each member's share.
    expect(panel).toHaveTextContent("bea@example.test paid $90.00 · Oct 18");
    expect(within(panel).queryByText("Total")).not.toBeInTheDocument();
    const shares = within(panel).getByRole("list", { name: "Shares of Hydro" });
    expect(within(shares).getAllByRole("listitem")).toHaveLength(3);
    expect(within(shares).getByText("bea@example.test · payer")).toBeInTheDocument();
    // Edit, Change history and Delete stay reachable from its … menu.
    await user.click(within(panel).getByRole("button", { name: "Hydro actions" }));
    const menu = within(panel).getByRole("list", { name: "Hydro actions" });
    expect(within(menu).getAllByRole("button").map((item) => item.textContent)).toEqual(["Edit", "Change history", "Delete"]);
    await user.click(within(menu).getByRole("button", { name: "Change history" }));
    await user.click(await within(panel).findByRole("button", { name: "Back to the expense" }));
    expect(await within(panel).findByRole("list", { name: "Shares of Hydro" })).toBeInTheDocument();
    // Choosing another expense opens it there and moves focus to it.
    await user.click(screen.getByRole("link", { name: /^Rent/ }));
    const rent = await screen.findByRole("region", { name: "Rent" });
    await waitFor(() => {
      expect(within(rent).getByRole("heading", { name: "Rent" })).toHaveFocus();
    });
    // A month with no expenses leaves the pane to Balances.
    await user.click(within(topbar()).getByRole("button", { name: "Next month" }));
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Rent" })).not.toBeInTheDocument();
    });
    expect(await screen.findByText("No shared expenses in November 2026")).toBeInTheDocument();
    // Back in October, the first expense is selected again.
    await user.click(within(topbar()).getByRole("button", { name: "Previous month" }));
    expect(await screen.findByRole("region", { name: "Hydro" })).toBeInTheDocument();
  });

  it("keeps an expense from another month open when it's opened directly", async () => {
    stubWidth(1194, true);
    const id = seed();
    const { alex } = ids();
    addExpense(ALEX, id, { title: "Hydro", totalCents: 9000, payerUserId: alex, date: "2026-10-18" });
    const internet = addExpense(ALEX, id, { title: "Internet", totalCents: 6000, payerUserId: alex, date: "2026-09-10" });
    serve();
    renderApp(`/households/${id}/expenses/${internet.id}`);
    expect(await screen.findByRole("list", { name: "This week" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Internet" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Hydro" })).not.toBeInTheDocument();
  });
});

describe("shared list, create and join", () => {
  it("creates a household in the ledger currency and opens People to invite", async () => {
    const fetchMock = serve();
    const user = userEvent.setup();
    const { router } = renderApp("/households");
    expect(await screen.findByRole("heading", { name: "Nothing shared yet" })).toBeInTheDocument();
    // The bar's + and the list's New household row both open it (card `iphone-shared-list`).
    expect(within(topbar()).getByRole("button", { name: "New household" })).toBeInTheDocument();
    await user.click(within(screen.getByRole("list", { name: "Start sharing" })).getByRole("button", { name: /New household/ }));
    const form = await dialog("New household");
    // The currency comes from the offline store, which can answer after the dialog opens.
    expect(await within(form).findByText(/Everyone who joins must use CAD too/)).toBeInTheDocument();

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

  it("lists households with a tile, members and this month's balance, and the overall position", async () => {
    const id = seed();
    addExpense(ALEX, id, { title: "Hydro", totalCents: 9000, payerUserId: ids().alex });
    addExpense(BEA, id, { title: "Old rent", totalCents: 3000, payerUserId: ids().bea, date: "2026-09-10" });
    serve();
    renderApp("/households");
    const row = await within(await screen.findByRole("main")).findByRole("link", { name: /Maison/ });
    await waitFor(() => {
      expect(row).toHaveTextContent(/3 members.*you're owed\$60\.00/);
    });
    expect(screen.getByText(/^October · you're owed/)).toHaveTextContent("October · you're owed $60.00 income overall");
    // The sidebar lists the household with its balance in whole units, as on the cards (MAZ-221).
    const sidebar = screen.getByRole("complementary", { name: "Penny" });
    const item = within(sidebar).getByRole("link", { name: /^Maison.*\$60, you're owed \$60\.00$/ });
    expect(item).toHaveTextContent("Maison$60");
    expect(within(sidebar).getByRole("link", { name: "All households" })).toHaveAttribute("href", "/households");
    // Together follows the cards (MAZ-240): the households, All households, then the trips and All trips.
    const together = screen.getByRole("heading", { name: "Together" }).parentElement as HTMLElement;
    expect(within(together).getAllByRole("link").map((link) => link.textContent)).toEqual([
      expect.stringMatching(/^Maison\$60/),
      "All households",
      "Trips",
    ]);
  });

  it("offers Record payment and Shared expense in the household header, with the balance's meaning in words and color", async () => {
    const id = seed();
    addExpense(BEA, id, { title: "Hydro", totalCents: 9000, payerUserId: ids().bea });
    serve();
    const user = userEvent.setup();
    renderApp(`/households/${id}`);
    const head = await screen.findByRole("region", { name: "Household summary" });
    await waitFor(() => {
      expect(head).toHaveTextContent("October · you owe $30.00");
    });
    const owe = within(head).getByText("$30.00");
    expect(owe).toHaveClass("money");
    expect(owe).not.toHaveClass("pk-money--income");
    expect(within(head).getByRole("button", { name: "Shared expense" })).toBeInTheDocument();
    const record = within(head).getByRole("link", { name: "Record payment" });
    expect(record).toHaveAccessibleDescription("Shows balances and suggested payments to record");
    await user.click(record);
    expect(await screen.findByRole("region", { name: "October" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Balances" })).toHaveAttribute("aria-current", "page");
  });

  it("shows a balance owed to you in the income color, named in words for screen readers too", async () => {
    const id = seed();
    addExpense(ALEX, id, { title: "Hydro", totalCents: 9000, payerUserId: ids().alex });
    serve();
    renderApp(`/households/${id}`);
    const head = await screen.findByRole("region", { name: "Household summary" });
    await waitFor(() => {
      expect(head).toHaveTextContent("October · you're owed $60.00");
    });
    expect(head.querySelector(".household-head__balance .money")).toHaveClass("pk-money--income");
  });
});

describe("shared expense form", () => {
  it("previews an equal split with remainder cents and sends it", async () => {
    const id = seed();
    const fetchMock = serve();
    const user = userEvent.setup();
    renderApp(`/households/${id}`);
    await user.click(await screen.findByRole("button", { name: "Shared expense" }));
    const form = await dialog("New expense");
    await fillExpense(user, form, "Groceries run", "100");
    const shares = within(form).getByRole("list", { name: "Shares" });
    const rows = within(shares).getAllByRole("listitem").map((row) => row.textContent);
    expect(rows).toEqual([expect.stringContaining("$33.34"), expect.stringContaining("$33.33"), expect.stringContaining("$33.33")]);
    expect(form.querySelector(".your-share")).toHaveTextContent("$33.34");
    // As on the card: everyone on the date is checked in, and an equal split shows no status box.
    expect(shares).toHaveAccessibleDescription(/Everyone who was a member on the expense date is included/);
    expect(within(form).queryByText(/Split equally/)).not.toBeInTheDocument();
    expect(form.querySelector(".your-share")).toHaveTextContent("Your share · in your spending");

    await user.click(within(form).getByRole("button", { name: /^(Save|Add expense)$/ }));
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
    const form = await dialog("New expense");
    await fillExpense(user, form, "Internet", "90");
    await user.click(within(form).getByRole("radio", { name: "Amounts" }));
    await user.type(within(form).getByLabelText("Your share in CAD"), "50");
    await user.type(within(form).getByLabelText(`${BEA}'s share in CAD`), "20");
    await user.type(within(form).getByLabelText(`${CAM}'s share in CAD`), "10");
    expect(within(form).getByText("$10.00 left to assign of $90.00.")).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: /^(Save|Add expense)$/ }));
    expect(within(form).getByText(/Shares must add up to \$90.00/)).toBeInTheDocument();
    expect(within(form).getByLabelText("Your share in CAD")).toHaveFocus();
    expect(callsTo(fetchMock, `/api/households/${id}/expenses`).filter((init) => init?.method === "POST")).toHaveLength(0);

    await user.clear(within(form).getByLabelText(`${CAM}'s share in CAD`));
    await user.type(within(form).getByLabelText(`${CAM}'s share in CAD`), "20");
    await user.click(within(form).getByRole("button", { name: /^(Save|Add expense)$/ }));
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
    const form = await dialog("New expense");
    await fillExpense(user, form, "Rent", "1000");
    await user.click(within(form).getByRole("radio", { name: "Percent" }));
    await user.type(within(form).getByLabelText("Your share in percent"), "50");
    await user.type(within(form).getByLabelText(`${BEA}'s share in percent`), "33.33");
    expect(within(form).getByText("16.67% left to assign.")).toBeInTheDocument();
    await user.type(within(form).getByLabelText(`${CAM}'s share in percent`), "16.67");
    expect(within(form).getByText("Adds up to 100%.")).toBeInTheDocument();
    expect(form.querySelector(".your-share")).toHaveTextContent("$500.00");
    await user.click(within(form).getByRole("button", { name: /^(Save|Add expense)$/ }));
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
    const form = await dialog("New expense");
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

    // The local changes can't reach the server (the fake ledger accepts PUTs since MAZ-93), so they stay unsynced.
    const fetchMock = serve({ unreachable: (method, url) => method === "PUT" && url === "/api/ledger" });
    const user = userEvent.setup();
    renderApp(`/households/${id}`);
    await user.click(await screen.findByRole("button", { name: "Shared expense" }));
    const form = await dialog("New expense");
    // Categories are sent by value, so one made offline can be used right away.
    await user.click(await within(form).findByRole("button", { name: /^Category: / }));
    const picker = screen.getByRole("dialog", { name: "Expense category" });
    expect(await within(picker).findByRole("button", { name: /Pets/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    // The server checks the account against its copy of the ledger, so an unsynced one waits.
    expect(within(form).getByRole("option", { name: "Everyday card" })).toBeEnabled();
    expect(within(form).getByRole("option", { name: "Cash jar (waiting to sync)" })).toBeDisabled();
    expect(within(form).getByLabelText("Your account")).toHaveAccessibleDescription(/can be chosen once they've synced/);

    await fillExpense(user, form, "Vet", "60");
    await user.click(within(form).getByRole("button", { name: /^Category: / }));
    await user.click(within(screen.getByRole("dialog", { name: "Expense category" })).getByRole("button", { name: /Pets/ }));
    expect(within(form).getByRole("button", { name: "Category: Pets" })).toBeInTheDocument();
    await user.selectOptions(within(form).getByLabelText("Your account"), "acct-visa");
    await user.click(within(form).getByRole("button", { name: /^(Save|Add expense)$/ }));
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
    await user.click(within(form).getByRole("button", { name: /^(Save|Add expense)$/ }));
    const banner = await within(form).findByRole("alert");
    expect(banner).toHaveTextContent("Someone else changed this while you were editing");
    expect(banner).toHaveTextContent("Hydro (October), $93.00");
    expect(title).toHaveValue("Hydro and gas");

    await user.click(within(form).getByRole("button", { name: "Keep my changes" }));
    await user.click(within(form).getByRole("button", { name: /^(Save|Add expense)$/ }));
    expect(await screen.findByText("Changes saved")).toBeInTheDocument();
    const puts = callsTo(fetchMock, `/api/households/${id}/expenses/${expense.id}`).filter((init) => init?.method === "PUT");
    expect(puts.map((init) => (bodyOf(init) as { revision: number }).revision)).toEqual([0, 1]);
  });

  it("creates a repeating expense as a shared rule and pauses it from its own dialog", async () => {
    const id = seed();
    const fetchMock = serve();
    const user = userEvent.setup();
    const { router } = renderApp(`/households/${id}`);
    await user.click(await screen.findByRole("button", { name: "Shared expense" }));
    const form = await dialog("New expense");
    await fillExpense(user, form, "Streaming", "18");
    await user.click(within(form).getByRole("button", { name: /^Receipt, repeat, note/ }));
    await user.selectOptions(within(form).getByLabelText("Repeat"), "monthly");
    expect(within(form).getByRole("button", { name: /^Receipt, repeat, note/ })).toHaveTextContent("Monthly");
    await user.click(within(form).getByRole("button", { name: /^(Save|Add expense)$/ }));
    expect(await screen.findByText("Streaming repeats monthly")).toBeInTheDocument();
    expect(bodyOf(callsTo(fetchMock, `/api/households/${id}/recurring`).find((init) => init?.method === "POST"))).toMatchObject({ nextDate: "2026-10-05", frequency: "monthly", totalCents: 1800 });

    // The household has no Repeating card (MAZ-229): Recurring links a rule here with `?rule=`.
    expect(screen.queryByRole("list", { name: "Repeating expenses" })).not.toBeInTheDocument();
    const rule = server.state.rules.find((item) => item.title === "Streaming");
    await router.navigate({ to: "/households/$id", params: { id }, search: { rule: rule?.id } });
    const details = await dialog("Streaming");
    expect(details).toHaveTextContent("Monthly");
    await user.click(within(details).getByRole("button", { name: "Pause Streaming" }));
    expect(await screen.findByText("Streaming paused")).toBeInTheDocument();
    expect(await within(details).findByText("Paused")).toBeInTheDocument();

    await user.click(within(details).getByRole("button", { name: "Stop repeating" }));
    const stop = await dialog("Stop repeating Streaming?");
    await user.click(within(stop).getByRole("button", { name: "Stop repeating" }));
    expect(await screen.findByText("Streaming no longer repeats")).toBeInTheDocument();
    expect(server.state.rules.some((item) => item.title === "Streaming")).toBe(false);
  });

  it("keeps the draft and says so when the browser is offline", async () => {
    const id = seed();
    let offline = false;
    serve({ offline: () => offline });
    const user = userEvent.setup();
    renderApp(`/households/${id}`);
    await user.click(await screen.findByRole("button", { name: "Shared expense" }));
    const form = await dialog("New expense");
    await fillExpense(user, form, "Plants", "12");
    offline = true;
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await user.click(within(form).getByRole("button", { name: /^(Save|Add expense)$/ }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("You're offline. Shared households need a connection, so nothing was sent. Your changes are still here.");
    expect(within(form).getByLabelText("Title")).toHaveValue("Plants");

    offline = false;
    online.mockReturnValue(true);
    await user.click(within(form).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Plants added")).toBeInTheDocument();
  });
});

describe("Add entry with a household", () => {
  async function openAdd(user: UserEvent) {
    await screen.findByRole("heading", { level: 1 });
    await user.keyboard("n");
    return screen.findByRole("form", { name: "New entry" });
  }

  /** The Household choice sits under "Receipt, repeat, trip" on phones (as MAZ-255 decided for iOS). */
  async function chooseHousehold(user: UserEvent, form: HTMLElement, name: string) {
    await user.click(within(form).getByRole("button", { name: /^Receipt, repeat, trip/ }));
    await user.selectOptions(within(form).getByLabelText("Household"), await within(form).findByRole("option", { name }));
  }

  it("draws Household as a row between Trip and Note, as iphone-entry-extras does", async () => {
    seed();
    serve();
    const user = userEvent.setup();
    renderApp("/");
    const form = await openAdd(user);
    await user.click(within(form).getByRole("button", { name: /^Receipt, repeat, trip/ }));
    const household = await within(form).findByRole("combobox", { name: "Household" });
    expect(household).toHaveValue("");
    expect(within(household).getByRole("option", { name: "Personal" })).toBeInTheDocument();
    expect(household).toHaveAccessibleDescription("Choose a household to split this expense with its members.");
    const trip = within(form).getByRole("group", { name: "Trip" });
    const note = within(form).getByLabelText("Note");
    expect(trip.compareDocumentPosition(household) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(household.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lists shared trips below your own trips and moves the expense to the one picked", async () => {
    seed();
    const created = server.handle(ALEX, "POST", "/api/households/trips", { name: "Tokyo spring", currency: "CAD", startDate: "2026-11-01", endDate: "2026-11-09" }).body as { household: { id: string } };
    serve();
    const user = userEvent.setup();
    renderApp("/");
    const form = await openAdd(user);
    await user.type(within(form).getByLabelText("Amount (CAD)"), "30");
    await user.type(within(form).getByLabelText("Title"), "Ramen");
    await user.click(within(form).getByRole("button", { name: /^Receipt, repeat, trip/ }));
    const trips = within(form).getByRole("group", { name: "Trip" });
    const shared = await within(trips).findByRole("radio", { name: /Tokyo spring/ });
    // As on iphone-entry-extras: after the personal trips, with "Shared · N people", never checked.
    expect(shared.closest("label")).toHaveTextContent("Shared · 1 person");
    expect(shared).not.toBeChecked();
    const options = within(trips).getAllByRole("radio");
    expect(options[options.length - 1]).toBe(shared);

    await user.click(shared);
    const sharedForm = await screen.findByRole("form", { name: "New expense" });
    expect(within(sharedForm).getByLabelText("Household")).toHaveValue(created.household.id);
    expect(within(sharedForm).getByLabelText("Title")).toHaveValue("Ramen");
    expect(within(sharedForm).getByLabelText("Amount (CAD)")).toHaveValue("30");
  });

  it("sends a new expense to a household from Add entry, keeping what was typed", async () => {
    const id = seed();
    const fetchMock = serve();
    const user = userEvent.setup();
    renderApp("/");
    const form = await openAdd(user);
    await user.type(within(form).getByLabelText("Amount (CAD)"), "100");
    await user.type(within(form).getByLabelText("Title"), "Groceries run");
    await chooseHousehold(user, form, "Maison");

    // The same dialog now holds the shared form, laid out like the personal one, with the typing kept.
    const shared = await screen.findByRole("form", { name: "New expense" });
    expect(within(shared).getByRole("group", { name: "Paid by" })).toBeInTheDocument();
    expect(within(shared).getByLabelText("Household")).toHaveValue(id);
    expect(within(shared).getByLabelText("Household")).toHaveAccessibleDescription(/Shared with Maison/);
    expect(within(shared).getByLabelText("Amount (CAD)")).toHaveValue("100");
    expect(within(shared).getByLabelText("Title")).toHaveValue("Groceries run");
    expect(shared.querySelector(".your-share")).toHaveTextContent("$33.34");

    await user.click(within(dialogOf(shared)).getByRole("button", { name: /^(Save|Add expense)$/ }));
    expect(await screen.findByText("Groceries run added")).toBeInTheDocument();
    const post = callsTo(fetchMock, `/api/households/${id}/expenses`).find((init) => init?.method === "POST");
    expect(bodyOf(post)).toMatchObject({ title: "Groceries run", totalCents: 10000, splitMode: "equal", payerUserId: ids().alex });
  });

  it("goes back to a personal entry with the typing kept", async () => {
    seed();
    serve();
    const user = userEvent.setup();
    renderApp("/");
    const form = await openAdd(user);
    await user.type(within(form).getByLabelText("Amount (CAD)"), "12");
    await user.type(within(form).getByLabelText("Title"), "Lunch");
    await chooseHousehold(user, form, "Maison");
    const shared = await screen.findByRole("form", { name: "New expense" });
    await within(shared).findByRole("group", { name: "Paid by" });

    await user.selectOptions(within(shared).getByLabelText("Household"), "Personal");
    const personal = await screen.findByRole("form", { name: "New entry" });
    expect(within(personal).queryByRole("group", { name: "Paid by" })).not.toBeInTheDocument();
    expect(within(personal).getByLabelText("Amount (CAD)")).toHaveValue("12");
    expect(within(personal).getByLabelText("Title")).toHaveValue("Lunch");
    expect(within(personal).getByLabelText("Household")).toHaveValue("");
  });
});

const dialogOf = (element: HTMLElement) => element.closest<HTMLElement>("[role=dialog]") ?? element;

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
    // The card's Record payment sheet: titled so, the payer and receiver, Full share and one action.
    expect(within(detail).getByRole("heading", { name: "Record payment" })).toBeInTheDocument();
    expect(within(detail).getByText("Full share")).toBeInTheDocument();
    expect(within(detail).getByText(/Penny keeps track — it doesn't send money, and nobody's spending changes/)).toBeInTheDocument();
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
    const row = (label: string) => within(stale).getByText(label, { selector: "dt" }).parentElement;
    expect(row("Total")).toHaveTextContent("was $96.30 now $104.10");
    expect(row("Your share")).toHaveTextContent("was $32.10 now $34.70");
    expect(row("Edited")).toHaveTextContent(`${BEA} · just now`);
    expect(stale).toHaveTextContent("Nothing was recorded.");
    expect(stale).toHaveFocus();
    expect(within(stale).queryByRole("button", { name: /Mark/ })).not.toBeInTheDocument();
    expect(server.state.reimbursements).toHaveLength(0);
    expect(callsTo(fetchMock, `/api/households/${id}/expenses/${expense.id}/payments`)).toHaveLength(1);

    await user.click(within(stale).getByRole("button", { name: "Review expense" }));
    expect(within(detail).getByText("Your share · in your spending").parentElement).toHaveTextContent("$34.70");
  });

  it("says another payment caused a stale share payment, and shows only what changed", async () => {
    const id = seed();
    const expense = addExpense(BEA, id, { title: "Internet", totalCents: 8000, payerUserId: ids().bea, splitMode: "equal" });
    serve();
    const user = userEvent.setup();
    renderApp(`/households/${id}/expenses/${expense.id}`);
    const detail = await dialog("Internet");
    await user.click(within(detail).getByRole("button", { name: "Mark your share as paid" }));
    // The same person records the share from another device first.
    server.handle(ALEX, "POST", `/api/households/${id}/expenses/${expense.id}/payments`, { fromUserId: ids().alex, revision: 0 });
    await user.click(within(detail).getByRole("button", { name: /^Mark \$.+ as paid$/ }));
    const stale = await within(detail).findByRole("alert");
    expect(stale).toHaveTextContent("Internet payment changed");
    expect(stale).toHaveTextContent("You already recorded your share as paid after you opened this payment, maybe on another device.");
    expect(stale).not.toHaveTextContent("edited this expense");
    const row = (label: string) => within(stale).queryByText(label, { selector: "dt" })?.parentElement;
    expect(row("Edited")).toBeUndefined();
    expect(row("Recorded")).toHaveTextContent("You · just now");
    expect(row("Total")).toBeUndefined();
    expect(row("Your share")).toBeUndefined();
    expect(row("Your share status")).toHaveTextContent("was Not repaid yet now Repaid");
    expect(stale).toHaveTextContent("Nothing was recorded.");
    expect(server.state.reimbursements).toHaveLength(1);
  });

  it("opens monthly payments on the last day and handles a repeated payment as stale", async () => {
    const id = seed();
    addExpense(BEA, id, { title: "Hydro", totalCents: 9000, payerUserId: ids().bea });
    serve();
    const user = userEvent.setup();
    const { unmount } = renderApp(`/households/${id}?tab=balances`);
    const card = await screen.findByRole("region", { name: "Suggested payments" });
    expect(screen.getByText(/Monthly payments open on the last day of the month/)).toBeInTheDocument();
    // Record paid shows, but isn't available before the month's last day.
    expect(within(card).getByRole("button", { name: "Record paid" })).toBeDisabled();
    expect(within(card).queryByRole("button", { name: /Record that/ })).not.toBeInTheDocument();
    unmount();

    vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
    renderApp(`/households/${id}?tab=balances`);
    const open = await screen.findByRole("region", { name: "Suggested payments" });
    await user.click(within(open).getByRole("button", { name: `Record that You paid ${BEA} $30.00` }));
    const record = await dialog("Record payment");
    expect(record).toHaveTextContent("Penny keeps track — it doesn't send money");
    // Cam records the same transfer from another device first? No: Bea records Alex's payment first.
    server.handle(BEA, "POST", `/api/households/${id}/months/2026-10/reimbursements`, { fromUserId: ids().alex, toUserId: ids().bea, amountCents: 3000 });
    await user.click(within(record).getByRole("button", { name: "Mark $30.00 as paid" }));
    const stale = await screen.findByRole("alert", { name: "October 2026 changed" });
    expect(stale).toHaveTextContent("Nothing was recorded.");
    expect(within(stale).getByText(`You → ${BEA}`).parentElement).toHaveTextContent("was $30.00 now Nothing to pay");
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
    const open = await screen.findByRole("region", { name: "Suggested payments" });
    await user.click(within(open).getByRole("button", { name: `Record that You paid ${BEA} $30.00` }));
    const record = await dialog("Record payment");
    server.handle(BEA, "POST", `/api/households/${id}/months/2026-10/reimbursements`, { fromUserId: ids().alex, toUserId: ids().bea, amountCents: 3000 });
    monthDown = true;
    await user.click(within(record).getByRole("button", { name: "Mark $30.00 as paid" }));
    const alert = await within(record).findByRole("alert");
    expect(alert).toHaveTextContent("October 2026 changed after you opened this payment, so nothing was recorded.");
    expect(alert).toHaveTextContent("Penny couldn't load the new balance either: Penny can't reach the server.");
    expect(screen.queryByRole("alert", { name: "October 2026 changed" })).not.toBeInTheDocument();
    expect(server.state.reimbursements).toHaveLength(1);

    // Once the month loads again, trying again shows the new balance.
    monthDown = false;
    await user.click(within(record).getByRole("button", { name: "Mark $30.00 as paid" }));
    expect(within(await screen.findByRole("alert", { name: "October 2026 changed" })).getByText(`You → ${BEA}`).parentElement).toHaveTextContent("Nothing to pay");
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
    // Leave is in the navigation bar's … menu (card `iphone-shared-people`).
    await user.click(await screen.findByRole("button", { name: "Household actions" }));
    await user.click(within(topbar()).getByRole("button", { name: "Leave household" }));
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
    await user.click(await screen.findByRole("button", { name: "Household actions" }));
    await user.click(within(topbar()).getByRole("button", { name: "Archive household" }));
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

    // Member rows carry no actions (MAZ-229): removal starts in the navigation bar's … menu.
    expect(within(screen.getByRole("list", { name: "Members" })).queryByRole("button")).not.toBeInTheDocument();
    await user.click(within(topbar()).getByRole("button", { name: "Household actions" }));
    await user.click(within(topbar()).getByRole("button", { name: "Remove someone" }));
    const pick = await dialog("Remove someone");
    await user.click(within(pick).getByRole("button", { name: CAM }));
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
    expect(history).toHaveTextContent(`${BEA} joined the household`);
    await user.click(within(history).getByRole("radio", { name: "Payments" }));
    expect(history).toHaveTextContent(`You recorded a payment$30.00 share to ${BEA}`);
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

describe("deleting a shared expense (iphone-delete-confirm, MAZ-225)", () => {
  it("names the expense, its total, date and household, and who else loses it, then deletes it for everyone", async () => {
    const id = seed();
    const expense = addExpense(ALEX, id, { title: "Internet", totalCents: 8000, payerUserId: ids().alex, date: "2026-10-10" });
    const fetchMock = serve();
    const user = userEvent.setup();
    renderApp(`/households/${id}/expenses/${expense.id}`);
    const detail = await dialog("Internet");
    await user.click(within(detail).getByRole("button", { name: "Delete" }));
    const confirm = await dialog("Delete “Internet”?");
    expect(confirm).toHaveTextContent(/\$80\.00 · Oct\.? 10 · Maison/);
    expect(confirm).toHaveTextContent(`Deleting it removes it for ${BEA}`);
    expect(confirm).toHaveTextContent("recalculates October balances.");
    expect(within(confirm).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(within(confirm).getByRole("button", { name: "Delete for everyone" }));
    expect(await screen.findByText("Internet deleted")).toBeInTheDocument();
    const deletes = fetchMock.mock.calls.filter(([input, init]) => String(input instanceof Request ? input.url : input).includes(`/expenses/${expense.id}`) && init?.method === "DELETE");
    expect(deletes).toHaveLength(1);
  });
});
