import { onlineManager } from "@tanstack/react-query";
import { act, configure, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entry, ledgerServer, personalHit, setOnline, sharedHit, sharedRow } from "./fakes/ledgerServer";
import { renderApp } from "./render";

/**
 * Activity at `/transactions` (MAZ-88): period totals with shared shares, URL-backed filters,
 * shared rows next to personal ones online and from cache offline. Synthetic data only.
 */
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 20_000 });

// The clock is pinned to Wed Nov 11, 2026, local noon: the November entries are before it, and income
// dated after it is expected (MAZ-136), so the totals hold on any day CI runs.
const TODAY = new Date("2026-11-11T12:00:00");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  onlineManager.setOnline(true);
});

const rent = entry("rent", "Rent", { total: 145000, share: 145000, date: "2026-11-01", categoryId: "food" });
const pay = entry("pay", "Monthly salary", { kind: "income", categoryId: "salary", total: 480000, share: 480000, date: "2026-11-05" });
const fund = entry("fund", "Index fund", { kind: "investment", categoryId: "investments", total: 20000, share: 20000, date: "2026-11-07" });
const groceries = entry("gro", "Weekend groceries", { total: 7235, share: 7235, date: "2026-11-06" });
const october = entry("oct", "October groceries", { date: "2026-10-30" });
const hydro = sharedRow({ id: "e1", title: "Hydro", date: "2026-11-03", shareCents: 3000, category: "Groceries" });

function server(search?: (body: Record<string, unknown>) => object[]) {
  return ledgerServer(
    { transactions: [rent, pay, fund, groceries, october] },
    {
      shared: [hydro],
      search:
        search ??
        ((body) => {
          const all = [personalHit(fund), personalHit(groceries), personalHit(pay), sharedHit(hydro), personalHit(rent)];
          return all.filter((item) => !body.kind || ("householdId" in item.entry ? body.kind === "expense" : item.entry.kind === body.kind));
        }),
    },
  );
}

const results = () => screen.getByRole("region", { name: "Search results" });

/**
 * A desktop window (`web-activity`, MAZ-225): `min-width` queries answer for 1440px with a fine
 * pointer, so Activity shows the summary line and the table. Without it jsdom has no
 * `matchMedia` and Activity lays out for a phone.
 */
function stubDesktop() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      const matches = query.includes("pointer: coarse") ? false : min ? 1440 >= Number(min[1]) : query.includes("hover");
      return { matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    }),
  );
}

/** The desktop summary of the period: "5 entries · spent … · in …". */
const summary = () => document.querySelector(".activity-summary") as HTMLElement;

/** Filters, from the phone's period chip. */
async function openFilters(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Period: .* Change filters$/ }));
  return screen.getByRole("dialog", { name: "Filters" });
}

describe("Activity", () => {
  it("totals the month from personal entries and your shared shares, whatever the search or filters", async () => {
    stubDesktop();
    const api = server(() => [personalHit(pay)]);
    renderApp("/transactions?month=2026-11&kind=income&q=salary");
    expect(await within(await screen.findByRole("region", { name: "Search results" })).findByText("Monthly salary")).toBeInTheDocument();
    await waitFor(() => {
      expect(summary()).toHaveTextContent("5 entries · spent $1,552.35 · in $4,800.00");
    });
    expect(summary()).toHaveTextContent("Spent includes your share of 1 shared expense.");
    expect(api.state.searches).toContainEqual({ query: "salary", from: "2026-11-01", to: "2026-11-30", kind: "income", pageSize: 50 });
    expect(api.state.projections).toContain("/api/households/projection?month=2026-11");
  });

  it("marks income dated after today as expected, but not a future-dated expense (MAZ-136)", async () => {
    // Tomorrow, the day after the pinned clock.
    const tomorrow = "2026-11-12";
    const bonus = entry("bonus", "Year-end bonus", { kind: "income", categoryId: "salary", total: 50000, share: 50000, date: tomorrow });
    const tickets = entry("tickets", "Concert tickets", { total: 9000, share: 9000, date: tomorrow, categoryId: "food" });
    ledgerServer({ transactions: [bonus, tickets] }, { shared: [], search: () => [personalHit(bonus), personalHit(tickets)] });
    renderApp("/transactions?month=2026-11");
    // On a phone: the list's rows.
    const row = await within(await screen.findByRole("region", { name: "Search results" })).findByRole("button", { name: /Year-end bonus/ });
    expect(row).toHaveTextContent("Expected");
    expect(row.querySelector(".category-dot--expected")).not.toBeNull();
    expect(row).toHaveTextContent("expected");
    const expense = within(results()).getByRole("button", { name: /Concert tickets/ });
    expect(expense).not.toHaveTextContent("Expected");
    expect(expense.querySelector(".category-dot--expected")).toBeNull();
  });

  it("leaves expected income out of the desktop summary and says so (MAZ-136)", async () => {
    stubDesktop();
    const bonus = entry("bonus", "Year-end bonus", { kind: "income", categoryId: "salary", total: 50000, share: 50000, date: "2026-11-12" });
    const tickets = entry("tickets", "Concert tickets", { total: 9000, share: 9000, date: "2026-11-12", categoryId: "food" });
    ledgerServer({ transactions: [bonus, tickets] }, { shared: [], search: () => [personalHit(bonus), personalHit(tickets)] });
    renderApp("/transactions?month=2026-11");
    const table = await within(await screen.findByRole("region", { name: "Search results" })).findByRole("table");
    expect(within(table).getByRole("button", { name: /^Year-end bonus/ })).toHaveTextContent("Expected");
    expect(within(table).getByRole("button", { name: "Edit Year-end bonus" })).toBeInTheDocument();
    await waitFor(() => {
      expect(summary()).toHaveTextContent("2 entries · spent $90.00 · in $0.00");
    });
    expect(summary()).toHaveTextContent("In leaves out $500.00 of income dated after today, listed as Expected until its date.");
  });

  it("lists shared rows beside personal ones and opens them in their household", async () => {
    server();
    renderApp("/transactions?month=2026-11");
    const link = await within(await screen.findByRole("region", { name: "Search results" })).findByRole("link", { name: /Hydro/ });
    expect(link).toHaveAttribute("href", "/households/h1/expenses/e1");
    expect(link).toHaveTextContent("Shared · Maison");
    expect(link).toHaveTextContent("your share");
    expect(within(results()).getByRole("button", { name: /Weekend groceries/ })).toBeInTheDocument();
  });

  it("shows this device's entries and the cached shared rows while offline", async () => {
    stubDesktop();
    server(() => []);
    renderApp("/transactions?month=2026-11");
    // Online and up to date: the server's search (which returns nothing here).
    expect(await screen.findByText("No matching transactions.")).toBeInTheDocument();
    await waitFor(() => {
      expect(summary()).toHaveTextContent("shared expense");
    });
    setOnline(false);
    expect(await screen.findByText("5 matching transactions on this device")).toBeInTheDocument();
    expect(within(results()).getByRole("link", { name: /Hydro/ })).toBeInTheDocument();
    expect(results()).toHaveTextContent("Shared expenses are as Penny last loaded them");
    expect(within(results()).queryByText("October groceries")).not.toBeInTheDocument();
    expect(summary()).toHaveTextContent("as Penny last loaded them");
  });

  it("keeps type, period, day and category filters in the URL, so Back restores them", async () => {
    const api = server();
    const user = userEvent.setup();
    const { router, history } = renderApp("/transactions?month=2026-11");
    await within(await screen.findByRole("region", { name: "Search results" })).findByText("Rent");

    await user.click(screen.getByRole("radio", { name: "Expenses" }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ month: "2026-11", kind: "expense" });
    });
    expect(api.state.searches).toContainEqual({ from: "2026-11-01", to: "2026-11-30", kind: "expense", pageSize: 50 });

    let filters = await openFilters(user);
    await user.click(within(filters).getByRole("button", { name: "Next month" }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ month: "2026-12", kind: "expense" });
    });
    await user.click(within(filters).getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: /^Period: December 2026\./ })).toHaveTextContent("December");

    history.back();
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ month: "2026-11", kind: "expense" });
    });
    expect(screen.getByRole("radio", { name: "Expenses" })).toBeChecked();

    filters = await openFilters(user);
    await user.click(within(filters).getByRole("radio", { name: "Year" }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ year: "2026", kind: "expense" });
    });
    expect(api.state.searches).toContainEqual({ from: "2026-01-01", to: "2026-12-31", kind: "expense", pageSize: 50 });

    const day = within(filters).getByLabelText("Day");
    await user.type(day, "2026-11-06");
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ year: "2026", day: "2026-11-06" });
    });
    expect(api.state.searches).toContainEqual({ from: "2026-11-06", to: "2026-11-06", kind: "expense", pageSize: 50 });

    await user.click(within(filters).getByRole("button", { name: "Clear filters" }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ year: "2026" });
    });
  });

  it("filters by a frequent category inline or any category from All categories, including shared rows by name", async () => {
    server();
    const user = userEvent.setup();
    const { router } = renderApp("/transactions?month=2026-11");
    await within(await screen.findByRole("region", { name: "Search results" })).findByText("Rent");
    const filters = await openFilters(user);
    const chips = await within(filters).findByRole("group", { name: "Category" });
    expect(within(chips).getByRole("radio", { name: "All" })).toBeChecked();

    await user.click(within(chips).getByRole("radio", { name: "Groceries" }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ month: "2026-11", category: "groceries" });
    });
    expect(within(results()).getByText("Weekend groceries")).toBeInTheDocument();
    expect(within(results()).getByRole("link", { name: /Hydro/ })).toBeInTheDocument();
    expect(within(results()).queryByText("Rent")).not.toBeInTheDocument();
    expect(screen.getByText("2 matching transactions")).toBeInTheDocument();

    await user.click(within(chips).getByRole("button", { name: "All categories" }));
    const picker = screen.getByRole("dialog", { name: "Filter by category" });
    await user.click(within(picker).getByRole("button", { name: /Salary/ }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ month: "2026-11", category: "salary" });
    });
    expect(await within(await screen.findByRole("region", { name: "Search results" })).findByText("Monthly salary")).toBeInTheDocument();
  });

  it("lists the month by day on phones, with each day's total, after the chips and before the search field (MAZ-175, MAZ-225)", async () => {
    server();
    renderApp("/transactions?month=2026-11");
    const list = await screen.findByRole("region", { name: "Search results" });
    await within(list).findByText("Rent");
    const days = within(list).getAllByRole("heading", { level: 2 });
    expect(days.map((day) => day.textContent)).toEqual([expect.stringMatching(/^Saturday, Nov\.? 7$/), expect.stringMatching(/^Friday, Nov\.? 6$/), expect.stringMatching(/^Thursday, Nov\.? 5$/), expect.stringMatching(/^Tuesday, Nov\.? 3$/), expect.stringMatching(/^Sunday, Nov\.? 1$/)]);
    const totalOf = (day: HTMLElement) => day.closest(".day-group__head")?.querySelector(".day-group__total")?.textContent;
    // Day totals need the ledger's currency, which comes with the ledger the offline store is downloading.
    await waitFor(() => {
      expect(within(list).getAllByRole("heading", { level: 2 }).map(totalOf)).toEqual(["Day total −$200.00", "Day total −$72.35", "Day total +$4,800.00 income", "Day total −$30.00", "Day total −$1,450.00"]);
    });
    // jsdom has no matchMedia, so this is the phone layout: the chips, the list, then the search field at the bottom.
    const search = screen.getByRole("searchbox", { name: "Search transactions" });
    expect(search).toHaveAttribute("placeholder", "Search activity");
    expect(list.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Period: November 2026\./ })).toHaveTextContent("November");
    expect(screen.getByRole("group", { name: "Type" }).compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers to search every period or drop the filters when nothing matches (MAZ-175)", async () => {
    server(() => []);
    const user = userEvent.setup();
    const { router } = renderApp("/transactions?month=2026-11&kind=expense&q=sushi");
    expect(await screen.findByRole("heading", { name: "No results for “sushi”" })).toBeInTheDocument();
    const empty = within(results());
    expect(empty.getByText(/Nothing matches in November expenses\. Try another word, or search everything\./)).toBeInTheDocument();
    // While searching, the active filters are removable chips (iphone-search-empty).
    const active = screen.getByRole("list", { name: "Active filters" });
    expect(within(active).getAllByRole("button").map((chip) => chip.getAttribute("aria-label"))).toEqual(["Remove filter: Expenses", "Remove filter: November"]);
    await user.click(empty.getByRole("button", { name: "Search all months" }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ kind: "expense", q: "sushi" });
    });
    await user.click(within(await screen.findByRole("region", { name: "Search results" })).getByRole("button", { name: "Clear filters" }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ q: "sushi" });
    });
  });

  it("says when nothing matches a search", async () => {
    server(() => []);
    renderApp("/transactions?q=zzz");
    expect(await screen.findByRole("heading", { name: "No results for “zzz”" })).toBeInTheDocument();
    expect(screen.getByText("No matching transactions.")).toBeInTheDocument();
  });
});

describe("Activity on a desktop (web-activity, MAZ-225)", () => {
  it("lists the period as a table and opens an entry in the panel beside it, with its split", async () => {
    stubDesktop();
    const dinner = entry("din", "Dinner out", { total: 1280, share: 640, date: "2026-11-09", categoryId: "food", note: "Catch-up" });
    ledgerServer({ transactions: [dinner, rent] }, { shared: [], search: () => [personalHit(dinner), personalHit(rent)] });
    const user = userEvent.setup();
    renderApp("/transactions?month=2026-11");
    const table = await within(await screen.findByRole("region", { name: "Search results" })).findByRole("table");
    expect([...table.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual(["Entry", "Account", "Split", "Amount", "Actions"]);
    // Day rows head their entries, with the day's total.
    expect(within(table).getByRole("columnheader", { name: /Monday, Nov\.? 9/ })).toBeInTheDocument();
    const row = within(table).getByRole("row", { name: /Dinner out/ });
    expect(row).toHaveTextContent("2 people");
    // Categories and the currency come with the ledger the offline store is downloading.
    await waitFor(() => {
      expect(row).toHaveTextContent("−$6.40");
    });

    await user.click(within(row).getByRole("button", { name: /^Dinner out/ }));
    const panel = screen.getByRole("complementary", { name: "Dinner out" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The panel can open before the categories and the household currency load.
    await waitFor(() => {
      expect(panel).toHaveTextContent("−$6.40your share of $12.80");
    });
    const split = within(panel).getByRole("region", { name: "Split" });
    expect(within(split).getByText("Equally · 2 people")).toBeInTheDocument();
    expect(within(split).getByText("Total").nextElementSibling).toHaveTextContent("$12.80");
    const details = within(panel).getByRole("region", { name: "Details" });
    expect(within(details).getByText("Repeats").nextElementSibling).toHaveTextContent("Never");
    expect(within(details).getByText("Note").nextElementSibling).toHaveTextContent("Catch-up");
    expect(within(row).getByRole("button", { name: /^Dinner out/ })).toHaveAttribute("aria-current", "true");

    await user.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary", { name: "Dinner out" })).not.toBeInTheDocument();
  });

  it("keeps the type chips and Filters while searching, with the period beside the title (web-activity-searching, MAZ-273)", async () => {
    stubDesktop();
    server();
    renderApp("/transactions?month=2026-11&q=salary");
    expect(await within(await screen.findByRole("region", { name: "Search results" })).findByText("Monthly salary")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Expenses" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove filter/ })).not.toBeInTheDocument();
  });

  it("sets the panel aside while Edit is open, with no row selected (web-edit-entry, MAZ-273)", async () => {
    stubDesktop();
    const dinner = entry("din", "Dinner out", { total: 1280, share: 640, date: "2026-11-09", categoryId: "food" });
    ledgerServer({ transactions: [dinner, rent] }, { shared: [], search: () => [personalHit(dinner), personalHit(rent)] });
    const user = userEvent.setup();
    renderApp("/transactions?month=2026-11");
    const table = await within(await screen.findByRole("region", { name: "Search results" })).findByRole("table");
    await user.click(within(table).getByRole("button", { name: /^Dinner out/ }));
    const panel = screen.getByRole("complementary", { name: "Dinner out" });
    await user.click(within(panel).getByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("form", { name: "Edit entry" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Dinner out" })).not.toBeInTheDocument();
    expect(within(table).getByRole("button", { name: /^Dinner out/ })).not.toHaveAttribute("aria-current");

    // Cancel brings the entry back beside the list.
    await user.keyboard("{Escape}");
    expect(await screen.findByRole("complementary", { name: "Dinner out" })).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: /^Dinner out/ })).toHaveAttribute("aria-current", "true");
  });

  it("brings the set-aside panel back, saying so, when another device deletes the entry being edited", async () => {
    stubDesktop();
    const dinner = entry("din", "Dinner out", { total: 1280, share: 640, date: "2026-11-09", categoryId: "food" });
    const { otherDevice } = ledgerServer({ transactions: [dinner, rent] }, { shared: [], search: () => [personalHit(dinner), personalHit(rent)] });
    const user = userEvent.setup();
    renderApp("/transactions?month=2026-11");
    const table = await within(await screen.findByRole("region", { name: "Search results" })).findByRole("table");
    await user.click(within(table).getByRole("button", { name: /^Dinner out/ }));
    await user.click(within(screen.getByRole("complementary", { name: "Dinner out" })).getByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("form", { name: "Edit entry" })).toBeInTheDocument();

    otherDevice((ledger) => ({ ...ledger, transactions: ledger.transactions.filter((item) => item.id !== "din") }));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const panel = await screen.findByRole("complementary", { name: "Dinner out" });
    expect(panel).toHaveTextContent("It was deleted on another device or in another tab.");
    expect(screen.queryByRole("form", { name: "Edit entry" })).not.toBeInTheDocument();
  });

  it("moves through the table with the arrow keys, edits with E and deletes with ⌫", async () => {
    stubDesktop();
    const dinner = entry("din", "Dinner out", { total: 1280, share: 640, date: "2026-11-09", categoryId: "food" });
    ledgerServer({ transactions: [dinner, rent] }, { shared: [], search: () => [personalHit(dinner), personalHit(rent)] });
    const user = userEvent.setup();
    renderApp("/transactions?month=2026-11");
    const table = await within(await screen.findByRole("region", { name: "Search results" })).findByRole("table");
    expect(document.getElementById(table.getAttribute("aria-describedby") ?? "")).toHaveTextContent("Keyboard: ↑ ↓ move · ↵ open · E edit · ⌫ delete");
    within(table).getByRole("button", { name: /^Dinner out/ }).focus();
    await user.keyboard("{ArrowDown}");
    expect(within(table).getByRole("button", { name: /^Rent/ })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(within(table).getByRole("button", { name: /^Dinner out/ })).toHaveFocus();

    await user.keyboard("e");
    expect(await screen.findByRole("form", { name: "Edit entry" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("form", { name: "Edit entry" })).not.toBeInTheDocument();
    });

    within(table).getByRole("button", { name: /^Rent/ }).focus();
    await user.keyboard("{Backspace}");
    const confirm = await screen.findByRole("dialog", { name: "Delete “Rent”?" });
    expect(confirm).toHaveTextContent("$1,450.00 · Nov 1");
    expect(within(confirm).getByRole("button", { name: "Cancel" })).toHaveFocus();
  });
});

/** A touch tablet in landscape (`ipad-activity`): 1194px wide, a coarse pointer and no hover. */
function stubTouchTablet() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      const matches = (!min || 1194 >= Number(min[1])) && !query.includes("hover: hover") && !query.includes("pointer: fine");
      return { matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    }),
  );
}

describe("Activity on a touch tablet (ipad-activity, MAZ-274)", () => {
  it("always shows an entry in the pane, with the card's split rows and no Close", async () => {
    stubTouchTablet();
    const dinner = entry("din", "Dinner out", { total: 1280, share: 640, date: "2026-11-09", categoryId: "food" });
    const taxi = entry("taxi", "Taxi home", { total: 3000, share: 1000, date: "2026-11-08", categoryId: "food" });
    ledgerServer({ transactions: [dinner, taxi, rent] }, { shared: [], search: () => [personalHit(dinner), personalHit(taxi), personalHit(rent)] });
    const user = userEvent.setup();
    renderApp("/transactions?month=2026-11");

    // Nothing was chosen, so the first listed entry is selected and shown.
    const pane = await screen.findByRole("complementary", { name: "Dinner out" });
    expect(within(results()).getByRole("button", { name: /^Dinner out/ })).toHaveAttribute("aria-current", "true");
    expect(within(pane).queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    expect(within(pane).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    const split = await within(pane).findByRole("region", { name: "Split, Equally · 2 people" });
    // The pane can open before the ledger's currency loads.
    await waitFor(() => {
      expect(within(split).getByText("Your share").nextElementSibling).toHaveTextContent("$6.40");
    });
    expect(within(split).getByText("1 other person").nextElementSibling).toHaveTextContent("$6.40");
    expect(within(split).queryByText("Total")).not.toBeInTheDocument();

    // Three ways: the other two people's share, together.
    await user.click(within(results()).getByRole("button", { name: /^Taxi home/ }));
    const taxiPane = await screen.findByRole("complementary", { name: "Taxi home" });
    const taxiSplit = within(taxiPane).getByRole("region", { name: "Split, Equally · 3 people" });
    expect(within(taxiSplit).getByText("2 other people").nextElementSibling).toHaveTextContent("$20.00");

    // Deleting the selected entry selects the first listed one again.
    await user.click(within(taxiPane).getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete “Taxi home”?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("complementary", { name: "Dinner out" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Taxi home" })).not.toBeInTheDocument();
  });

  it("selects the first listed entry when the filters hide the selected one", async () => {
    stubTouchTablet();
    const dinner = entry("din", "Dinner out", { total: 1280, share: 640, date: "2026-11-09", categoryId: "food" });
    ledgerServer(
      { transactions: [dinner, pay] },
      { shared: [], search: (body) => [personalHit(dinner), personalHit(pay)].filter((item) => !body.kind || item.entry.kind === body.kind) },
    );
    const user = userEvent.setup();
    renderApp("/transactions?month=2026-11");
    expect(await screen.findByRole("complementary", { name: "Dinner out" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Income" }));
    expect(await screen.findByRole("complementary", { name: "Monthly salary" })).toBeInTheDocument();
  });
});
