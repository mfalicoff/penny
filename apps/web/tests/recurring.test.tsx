import { onlineManager } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bodyOf, callsTo, emptyWireLedger, json, renderApp, stubServer } from "./render";

/**
 * Recurring schedules (MAZ-90) in the real app: router, Query, AuthGate and the durable offline
 * ledger over fake-indexeddb, against a revision-checked `GET`/`PUT /api/ledger`. Today is
 * Nov 10, 2026. Synthetic data only.
 */
type Wire = Omit<ReturnType<typeof emptyWireLedger>, "recurring" | "transactions"> & { recurring: object[]; transactions: object[] };
const categories = [
  { id: "home", name: "Home", icon: "home-outline", color: "#C6953A", kind: "expense" },
  { id: "salary", name: "Salary", icon: "briefcase-outline", color: "#6C9C79", kind: "income" },
  { id: "investments", name: "Investments", icon: "trending-up-outline", color: "#678DB1", kind: "investment" },
];
const rule = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  kind: "expense",
  total: 6500,
  share: 6500,
  categoryId: "home",
  date: "2026-03-18",
  note: "",
  frequency: "monthly",
  nextDate: "2026-11-18",
  anchorDay: 18,
  active: true,
  ...extra,
});

function ledgerServer(initial: Partial<Wire> = {}, other?: (url: string) => Response | undefined) {
  const state = {
    revision: 3,
    ledger: { ...emptyWireLedger(), categories, accounts: [{ id: "visa", name: "Visa", type: "credit" }], ...initial } as Wire,
    down: false,
  };
  const fetchMock = stubServer((url, init) => {
    if (url !== "/api/ledger") return other?.(url);
    if (state.down) throw new TypeError("Failed to fetch");
    if (init?.method === "PUT") {
      const body = bodyOf(init) as { revision: number; ledger: Wire };
      if (body.revision !== state.revision) return json({ error: "The ledger changed." }, 409);
      state.revision += 1;
      state.ledger = body.ledger;
    }
    return json({ revision: state.revision, ledger: state.ledger });
  });
  const puts = () => callsTo(fetchMock, "/api/ledger").filter((call) => call?.method === "PUT");
  return { state, fetchMock, puts };
}

function setOnline(value: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);
  act(() => {
    window.dispatchEvent(new Event(value ? "online" : "offline"));
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T12:00:00"));
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  onlineManager.setOnline(true);
});

/** The toolbar's New schedule (the empty state has another one). */
const newSchedule = () => screen.getAllByRole("button", { name: "New schedule" })[0] as HTMLElement;
const rules = (server: ReturnType<typeof ledgerServer>) => server.state.ledger.recurring as ReturnType<typeof rule>[];
const entries = (server: ReturnType<typeof ledgerServer>) => server.state.ledger.transactions as { id: string; title: string; total: number }[];

describe("recurring schedules", () => {
  it("lists active and paused schedules by kind with their next date", async () => {
    ledgerServer({
      recurring: [
        rule("pay", "Payday", { kind: "income", categoryId: "salary", total: 225000, share: 225000, nextDate: "2026-11-15", anchorDay: 15 }),
        rule("net", "Internet", { accountId: "visa" }),
        rule("gym", "Gym", { active: false, total: 4500, share: 4500, nextDate: "2026-10-01", anchorDay: 1 }),
        rule("tfsa", "TFSA contribution", { kind: "investment", categoryId: "investments", total: 20000, share: 20000, nextDate: "2026-12-06", anchorDay: 6 }),
      ],
    });
    renderApp("/recurring");
    expect(await screen.findByRole("heading", { level: 1, name: "Recurring" })).toBeInTheDocument();
    const income = await screen.findByRole("list", { name: "Income schedules" });
    expect(within(income).getByRole("button")).toHaveTextContent(/Payday.*Monthly · next Nov 15.*\+\$2,250\.00 income/);
    const expenses = screen.getByRole("list", { name: "Expense schedules" });
    const rows = within(expenses).getAllByRole("button");
    // From 768px the account (or household) also shows as its own column, hidden from assistive technology.
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringMatching(/^Internet.*next Nov 18 · Visa(Visa)?−\$65\.00/), expect.stringMatching(/^GymPaused · monthly−\$45\.00/)]);
    expect(screen.getByRole("list", { name: "Investment schedules" })).toHaveTextContent("TFSA contribution");
    expect(screen.getByText("Penny records these on their date.")).toBeInTheDocument();
    // The sidebar counts the active schedules beside Recurring, and so does Manage in Settings on phones (MAZ-221).
    expect(within(screen.getByRole("complementary", { name: "Penny" })).getByRole("link", { name: /^Recurring\s*3\s*active$/ })).toHaveTextContent("Recurring3");
  });

  it("lists shared schedules the account is part of with the expenses, marked Shared, with its share", async () => {
    const JOINED = Date.UTC(2026, 0, 5, 12);
    const household = { id: "h1", name: "Maison", currency: "CAD", creatorId: "u-alex", createdAt: JOINED, memberCount: 2 };
    const members = [
      { userId: "u-alex", email: "alex@example.test", joinedAt: JOINED, joinedOn: "2026-01-05" },
      { userId: "u-bea", email: "bea@example.test", joinedAt: JOINED, joinedOn: "2026-01-05" },
    ];
    const sharedRule = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
      id,
      householdId: "h1",
      title,
      totalCents: 1600,
      payerUserId: "u-bea",
      splitMode: "equal",
      category: { name: "Fun", icon: "film-outline", color: "#5E5CE6" },
      note: "",
      nextDate: "2026-11-20",
      frequency: "monthly",
      anchorDay: 20,
      active: true,
      revision: 1,
      ...extra,
    });
    ledgerServer({ recurring: [rule("net", "Internet", { accountId: "visa" })] }, (url) => {
      if (url === "/api/households") return json({ households: [household] });
      if (url === "/api/households/h1") return json({ household, members });
      if (url === "/api/households/h1/recurring") return json({ rules: [sharedRule("s1", "Streaming"), sharedRule("s2", "Cleaner", { active: false, totalCents: 6000 })] });
      return undefined;
    });
    renderApp("/recurring");
    const expenses = await screen.findByRole("list", { name: "Expense schedules" });
    await waitFor(() => {
      expect(within(expenses).getAllByRole("listitem")).toHaveLength(3);
    });
    expect(within(expenses).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^Internet.*next Nov 18/),
      expect.stringMatching(/^Streaming Shared\s*Monthly · next Nov 20Maison(Maison)?−\$8\.00your share/),
      expect.stringMatching(/^Cleaner Shared\s*Paused · monthlyMaison(Maison)?−\$30\.00your share/),
    ]);
    // A shared schedule opens its household, where it's edited.
    expect(within(expenses).getByRole("link", { name: /^Streaming/ })).toHaveAttribute("href", "/households/h1?rule=s1");
    expect(screen.getByText(/Shared schedules open their household and count only your share/)).toBeInTheDocument();
  });

  it("shows an empty state and adds a backdated monthly schedule, recording missed dates once", async () => {
    const server = ledgerServer();
    const user = userEvent.setup();
    renderApp("/recurring");
    expect(await screen.findByRole("heading", { name: "No schedules yet" })).toBeInTheDocument();
    await user.click(newSchedule());
    const dialog = screen.getByRole("dialog", { name: "New schedule" });
    expect(within(dialog).getByLabelText("Amount (CAD)")).toHaveFocus();

    // Nothing filled in: each problem is named and focus goes to the first.
    await user.click(within(dialog).getByRole("button", { name: "Add schedule" }));
    expect(within(dialog).getByLabelText("Amount (CAD)")).toHaveFocus();
    expect(within(dialog).getByLabelText("Amount (CAD)")).toHaveAccessibleDescription("Enter an amount with up to two decimal places.");
    expect(within(dialog).getByLabelText("Name")).toHaveAccessibleDescription("Add a name for this schedule.");

    await user.type(within(dialog).getByLabelText("Amount (CAD)"), "1450");
    await user.type(within(dialog).getByLabelText("Name"), "Rent");
    await user.clear(within(dialog).getByLabelText("First date"));
    await user.type(within(dialog).getByLabelText("First date"), "2026-09-30");
    expect(within(dialog).getByRole("status")).toHaveTextContent("Saving records 2 entries, Sep 30 through Oct 30 now, then monthly on the 30th.");
    await user.click(within(dialog).getByRole("button", { name: "Add schedule" }));

    expect(await screen.findByText("Rent added")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(rules(server)).toHaveLength(1);
    });
    expect(rules(server)[0]).toMatchObject({ title: "Rent", total: 145000, nextDate: "2026-11-30", anchorDay: 30, date: "2026-09-30" });
    expect(entries(server).map((entry) => entry.id.split(":")[1])).toEqual(["2026-09-30", "2026-10-30"]);
    expect(screen.getByRole("list", { name: "Expense schedules" })).toHaveTextContent("next Nov 30");
  });

  it("opens details from a row, pauses and resumes without recording paused dates, edits future dates only, and removes after confirming", async () => {
    const recorded = { id: "net:2026-10-18", title: "Internet", kind: "expense", total: 6500, share: 6500, categoryId: "home", accountId: "visa", date: "2026-10-18", note: "", recurringId: "net" };
    const server = ledgerServer({ recurring: [rule("net", "Internet", { accountId: "visa" })], transactions: [recorded] });
    const user = userEvent.setup();
    renderApp("/recurring");
    const row = await screen.findByRole("button", { name: /^Internet/ });
    await user.click(row);
    let dialog = screen.getByRole("dialog", { name: "Internet" });
    expect(dialog).toHaveTextContent("Every month on the 18th");
    expect(within(dialog).getByRole("list")).toHaveTextContent(/Wed, Nov 18, in 8 days.*Fri, Dec 18.*Mon, Jan 18, 2027/);
    expect(dialog).toHaveTextContent("Visa");

    await user.click(within(dialog).getByRole("button", { name: "Pause" }));
    expect(await screen.findByText("Internet paused")).toBeInTheDocument();
    expect(within(dialog).getByText(/Paused: Penny records nothing and skips its dates/)).toBeInTheDocument();
    await waitFor(() => {
      expect(rules(server)[0]?.active).toBe(false);
    });

    // Resuming a month later skips the paused dates.
    vi.setSystemTime(new Date("2026-12-20T12:00:00"));
    await user.click(within(dialog).getByRole("button", { name: "Resume" }));
    expect(await screen.findByText("Internet resumed")).toBeInTheDocument();
    await waitFor(() => {
      expect(rules(server)[0]).toMatchObject({ active: true, nextDate: "2027-01-18" });
    });
    expect(entries(server).map((entry) => entry.id)).toEqual(["net:2026-10-18"]);

    // Edit: a new amount applies to future dates; the recorded entry keeps its details.
    await user.click(within(dialog).getByRole("button", { name: "Edit" }));
    dialog = screen.getByRole("dialog", { name: "Edit schedule" });
    const amount = within(dialog).getByLabelText("Amount (CAD)");
    await user.clear(amount);
    await user.type(amount, "70");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Schedule updated")).toBeInTheDocument();
    dialog = screen.getByRole("dialog", { name: "Internet" });
    await waitFor(() => {
      expect(rules(server)[0]).toMatchObject({ total: 7000, anchorDay: 18 });
    });
    expect(entries(server)).toEqual([recorded]);

    // Remove asks first; Keep schedule goes back to the detail.
    await user.click(within(dialog).getByRole("button", { name: "Remove schedule" }));
    let confirm = screen.getByRole("dialog", { name: "Remove Internet?" });
    expect(confirm).toHaveAccessibleDescription(/Entries it already recorded stay in your activity/);
    await user.click(within(confirm).getByRole("button", { name: "Keep schedule" }));
    dialog = screen.getByRole("dialog", { name: "Internet" });
    await user.click(within(dialog).getByRole("button", { name: "Remove schedule" }));
    confirm = screen.getByRole("dialog", { name: "Remove Internet?" });
    await user.click(within(confirm).getByRole("button", { name: "Remove schedule" }));
    expect(await screen.findByText("Internet removed")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Focus recovers to New schedule, since the row is gone.
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "New schedule" })[0]).toHaveFocus();
    });
    await waitFor(() => {
      expect(rules(server)).toEqual([]);
    });
    expect(entries(server)).toEqual([recorded]);
  });

  it("saves offline on this device, marks the row, and syncs once on reconnect without duplicates", async () => {
    const server = ledgerServer();
    const user = userEvent.setup();
    renderApp("/recurring");
    await screen.findByRole("heading", { name: "No schedules yet" });
    server.state.down = true;
    setOnline(false);

    await user.click(newSchedule());
    const dialog = screen.getByRole("dialog", { name: "New schedule" });
    await user.click(within(dialog).getByRole("radio", { name: "Income" }));
    await user.type(within(dialog).getByLabelText("Amount (CAD)"), "2250");
    await user.type(within(dialog).getByLabelText("Name"), "Payday");
    await user.click(within(dialog).getByRole("radio", { name: "Weekly" }));
    await user.clear(within(dialog).getByLabelText("First date"));
    await user.type(within(dialog).getByLabelText("First date"), "2026-11-10");
    await user.click(within(dialog).getByRole("button", { name: "Add schedule" }));
    expect(await screen.findByText("Saved on this device. It syncs when you're back online.")).toBeInTheDocument();
    const row = screen.getByRole("button", { name: /^Payday/ });
    expect(row).toHaveTextContent("Waiting to sync");
    expect(row).toHaveTextContent("Weekly · next Nov 17");
    expect(await screen.findByText(/Offline · 2 changes waiting/)).toBeInTheDocument();

    server.state.down = false;
    setOnline(true);
    await waitFor(() => {
      expect(screen.queryByText(/changes? waiting/)).not.toBeInTheDocument();
    });
    expect(row).not.toHaveTextContent("Waiting to sync");
    expect(server.puts()).toHaveLength(1);
    expect(rules(server)).toMatchObject([{ title: "Payday", kind: "income", frequency: "weekly", nextDate: "2026-11-17" }]);
    expect(entries(server).map((entry) => entry.id.endsWith(":2026-11-10"))).toEqual([true]);
  });

  it("keeps the draft when the schedule changes elsewhere while editing", async () => {
    const server = ledgerServer({ recurring: [rule("net", "Internet")] });
    const user = userEvent.setup();
    renderApp("/recurring");
    await user.click(await screen.findByRole("button", { name: /^Internet/ }));
    await user.click(within(screen.getByRole("dialog", { name: "Internet" })).getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit schedule" });
    await user.clear(within(dialog).getByLabelText("Name"));
    await user.type(within(dialog).getByLabelText("Name"), "Fibre internet");

    // Another device renames it; this tab picks it up on its next sync.
    server.state.ledger = { ...server.state.ledger, recurring: [rule("net", "Home internet")] };
    server.state.revision += 1;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await within(dialog).findByText("This schedule changed on another device")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Fibre internet");
    await user.click(within(dialog).getByRole("button", { name: "Keep my changes" }));
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Schedule updated")).toBeInTheDocument();
    await waitFor(() => {
      expect(rules(server)[0]?.title).toBe("Fibre internet");
    });

    // Changing the type offers that type's categories; changing back keeps the rest of the draft.
    await user.click(within(screen.getByRole("dialog", { name: "Fibre internet" })).getByRole("button", { name: "Edit" }));
    const again = screen.getByRole("dialog", { name: "Edit schedule" });
    await user.type(within(again).getByLabelText("Note"), "Autopay");
    await user.selectOptions(within(again).getByLabelText("Category"), "home");
    await user.click(within(again).getByRole("radio", { name: "Income" }));
    expect(within(again).getByLabelText("Category")).toHaveValue("salary");
    await user.click(within(again).getByRole("radio", { name: "Expense" }));
    await user.click(within(again).getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(rules(server)[0]?.note).toBe("Autopay");
    });
  });

  it("refuses to save when the browser blocks storage and keeps what was typed", async () => {
    Reflect.deleteProperty(globalThis, "indexedDB");
    ledgerServer();
    const user = userEvent.setup();
    renderApp("/recurring");
    await screen.findByRole("heading", { name: "No schedules yet" });
    await user.click(newSchedule());
    const dialog = screen.getByRole("dialog", { name: "New schedule" });
    await user.type(within(dialog).getByLabelText("Amount (CAD)"), "18.99");
    await user.type(within(dialog).getByLabelText("Name"), "Streaming");
    await user.click(within(dialog).getByRole("button", { name: "Add schedule" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("This browser isn't letting Penny store data");
    expect(alert).toHaveTextContent("Your changes are still here.");
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Streaming");
    expect(within(dialog).getByLabelText("Amount (CAD)")).toHaveValue("18.99");
  });
});

describe("recurring suggestions (MAZ-290)", () => {
  const entry = (id: string, title: string, kind: string, share: number, date: string, categoryId = "home") => ({ id, title, kind, total: share, share, categoryId, accountId: "visa", date, note: "" });
  const repeating = () => [
    entry("n1", "Netflix", "expense", 1549, "2026-08-03"),
    entry("n2", "Netflix", "expense", 1549, "2026-09-03"),
    entry("n3", "Netflix", "expense", 1699, "2026-10-03"),
    entry("n4", "Netflix", "expense", 1699, "2026-11-03"),
    ...["2026-10-07", "2026-10-14", "2026-10-21", "2026-10-28", "2026-11-04"].map((date, index) => entry(`t${String(index)}`, "Tutoring", "income", 6000, date, "salary")),
  ];
  const suggestionRow = async (title: string) => {
    const list = await screen.findByRole("list", { name: "Suggested schedules" });
    const row = within(list)
      .getAllByRole("listitem")
      .find((item) => item.textContent.startsWith(title));
    if (!row) throw new Error(`no ${title} suggestion`);
    return row;
  };

  it("offers repeating entries above the schedules, and makes one a schedule from the filled-in form", async () => {
    const server = ledgerServer({ recurring: [rule("net", "Internet", { accountId: "visa" })], transactions: repeating() });
    const user = userEvent.setup();
    renderApp("/recurring");
    expect(await screen.findByRole("heading", { level: 2, name: /^Suggested,\s*2$/ })).toBeInTheDocument();
    const netflix = await suggestionRow("Netflix");
    expect(netflix).toHaveTextContent(/^NetflixExpenseEvery month, around the 3rdSeen 4 times since Aug 3−\$16\.99was \$15\.49Make it a scheduleDismiss$/);
    expect(await suggestionRow("Tutoring")).toHaveTextContent(/TutoringIncomeEvery week, on WednesdaysSeen 5 times since Oct 7\+\$60\.00 income/);
    expect(screen.getByText(/Penny found these repeating in your activity\. A schedule counts them in Projected; your past entries stay as they are\./)).toBeInTheDocument();

    // Cancel keeps the suggestion, and focus returns to its button.
    const make = within(netflix).getByRole("button", { name: "Make it a schedule" });
    expect(make).toHaveAccessibleDescription("Netflix");
    await user.click(make);
    let dialog = screen.getByRole("dialog", { name: "New schedule" });
    expect(dialog).toHaveTextContent("Filled in from 4 Netflix entries. Check it, then add it.");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(make).toHaveFocus();
    expect(await suggestionRow("Netflix")).toBeInTheDocument();

    await user.click(make);
    dialog = screen.getByRole("dialog", { name: "New schedule" });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Netflix");
    expect(within(dialog).getByLabelText("Amount (CAD)")).toHaveValue("16.99");
    expect(within(dialog).getByLabelText("First date")).toHaveValue("2026-12-03");
    expect(within(dialog).getByRole("radio", { name: "Monthly" })).toBeChecked();
    expect(within(dialog).getByRole("status")).toHaveTextContent("First on Dec 3, then monthly on the 3rd.");
    const matched = within(dialog).getByRole("region", { name: /^Already in your activity,\s*4 entries$/ });
    expect(within(matched).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Nov 3−$16.99", "Oct 3−$16.99", "Sep 3−$15.49", "Aug 3−$15.49"]);
    expect(matched).toHaveTextContent("These entries stay as they are. The first date is the next one after the latest, so nothing is recorded twice.");
    await user.click(within(dialog).getByRole("button", { name: "Add schedule" }));

    expect(await screen.findByText("Netflix added")).toBeInTheDocument();
    await waitFor(() => {
      expect(rules(server)).toHaveLength(2);
    });
    expect(rules(server)[1]).toMatchObject({ title: "Netflix", kind: "expense", total: 1699, share: 1699, categoryId: "home", accountId: "visa", frequency: "monthly", nextDate: "2026-12-03", anchorDay: 3 });
    // Past entries stay as they are, and nothing is recorded for a date already in the activity.
    expect(entries(server)).toEqual(repeating());
    // The suggestion is gone; focus continues on the new schedule's row.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Netflix.*next Dec 3/ })).toHaveFocus();
    });
    expect(screen.getByRole("heading", { level: 2, name: /^Suggested,\s*1$/ })).toBeInTheDocument();
  });

  it("dismisses at once with Undo on the toast, syncs the dismissal and moves focus sensibly", async () => {
    const server = ledgerServer({ transactions: repeating() });
    const user = userEvent.setup();
    renderApp("/recurring");
    const netflix = await suggestionRow("Netflix");
    await user.click(within(netflix).getByRole("button", { name: "Dismiss" }));
    // jsdom is phone width: the toast follows `iphone-suggestion-dismissed-toast` (the card captures in e2e/cards.real.spec.ts cover the desktop copy).
    expect(await screen.findByText("Suggestion dismissed")).toBeInTheDocument();
    expect(screen.getByText("Netflix · about $16.99 every month")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /^Suggested,\s*1$/ })).toBeInTheDocument();
    // Focus continues on the next suggestion.
    const tutoring = await suggestionRow("Tutoring");
    await waitFor(() => {
      expect(within(tutoring).getByRole("button", { name: "Make it a schedule" })).toHaveFocus();
    });
    await waitFor(() => {
      expect(server.state.ledger).toMatchObject({ dismissedSuggestions: ["expense|netflix|monthly|1699"] });
    });

    // Undo brings it back at its place, with focus on it.
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: /^Suggested,\s*2$/ })).toBeInTheDocument();
    });
    await waitFor(async () => {
      expect(within(await suggestionRow("Netflix")).getByRole("button", { name: "Make it a schedule" })).toHaveFocus();
    });
    await waitFor(() => {
      expect(server.state.ledger).toMatchObject({ dismissedSuggestions: [] });
    });

    // Dismissing the last one leaves the empty state, and focus on New schedule.
    await user.click(within(await suggestionRow("Netflix")).getByRole("button", { name: "Dismiss" }));
    await user.click(within(await suggestionRow("Tutoring")).getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByRole("heading", { name: "No schedules yet" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "New schedule" })[0]).toHaveFocus();
    });
    expect(screen.getByText(/Penny suggests it here\./)).toBeInTheDocument();
  });
});
