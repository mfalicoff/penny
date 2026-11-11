import { onlineManager } from "@tanstack/react-query";
import { configure, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { entry, ledgerServer, sharedRow } from "./fakes/ledgerServer";
import { renderApp } from "./render";

/**
 * Home and Insights (MAZ-92) in the real app over the durable ledger: recorded and projected
 * remaining, shared shares, filter-independent totals, the calendar, categories and the money
 * flow by keyboard, and the first-entry state. Synthetic data only.
 */
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  localStorage.clear();
  onlineManager.setOnline(true);
});

const pay = entry("pay", "Monthly salary", { kind: "income", categoryId: "salary", total: 480000, share: 480000, date: "2026-11-05" });
const rent = entry("rent", "Rent", { total: 145000, share: 145000, date: "2026-11-01", categoryId: "food" });
const coffee = entry("coffee", "Morning coffee", { total: 1240, share: 620, date: "2026-11-06", categoryId: "food" });
const fund = entry("fund", "Index fund", { kind: "investment", categoryId: "investments", total: 20000, share: 20000, date: "2026-11-07" });
const october = entry("oct", "October groceries", { total: 50000, share: 50000, date: "2026-10-30" });
const retainer = { id: "retainer", title: "Design retainer", kind: "income", total: 40000, share: 40000, categoryId: "salary", date: "2026-11-25", note: "", frequency: "monthly", nextDate: "2026-11-25", anchorDay: 25, active: true };
const hydro = sharedRow({ id: "e1", title: "Hydro", date: "2026-11-03", shareCents: 3000, category: "Utilities" });
const streaming = { ...sharedRow({ id: "p1", title: "Streaming", date: "2026-11-20", shareCents: 800, category: "Fun" }), scheduled: true, recurringId: "r1" };

function server(transactions = [pay, rent, coffee, fund, october]) {
  return ledgerServer({ transactions, recurring: [retainer] }, { shared: [hydro], scheduled: [streaming] });
}

const hero = () => screen.getByRole("region", { name: "Left to spend" });
const explore = () => screen.getByRole("region", { name: "Explore your month" });

describe("Home", () => {
  it("leads with recorded and projected remaining, naming the expected recurring income", async () => {
    const api = server();
    renderApp("/?month=2026-11");
    await waitFor(() => {
      expect(hero()).toHaveTextContent("Spent includes your share of 1 shared expense.");
    });
    // 4,800.00 − (1,450.00 + 6.20 + 30.00) − 200.00
    expect(within(hero()).getByText(/^Recorded remaining:/).parentElement).toHaveTextContent("$3,113.80");
    // + 400.00 expected income − 8.00 scheduled shared share
    expect(within(hero()).getByText(/^Projected remaining:/).parentElement).toHaveTextContent("$3,505.80");
    expect(hero()).toHaveTextContent("includes $400.00 expected recurring income and $8.00 scheduled to go out");
    expect(within(hero()).getByText("Came in").parentElement).toHaveTextContent("$4,800.00");
    expect(within(hero()).getByText("Spent · your share").parentElement).toHaveTextContent("$1,486.20");
    expect(within(hero()).getByText("Invested").parentElement).toHaveTextContent("$200.00");
    expect(api.state.projections).toContain("/api/households/projection?month=2026-11");

    const coming = screen.getByRole("region", { name: "Coming up" });
    expect(within(coming).getAllByRole("listitem").map((item) => item.textContent)).toEqual([expect.stringContaining("Streaming"), expect.stringContaining("Design retainer")]);
    const recent = screen.getByRole("region", { name: "Recent" });
    expect(within(recent).getByRole("link", { name: /Hydro/ })).toHaveAttribute("href", "/households/h1/expenses/e1");
    expect(within(recent).getByRole("link", { name: "See all" })).toHaveAttribute("href", "/transactions?month=2026-11");
    expect(within(recent).queryByText("October groceries")).not.toBeInTheDocument();
  });

  it("says when the month is overspent, in words", async () => {
    server([rent, coffee]);
    renderApp("/?month=2026-11");
    expect(await within(await screen.findByRole("region", { name: "Left to spend" })).findByText("Overspent")).toBeInTheDocument();
    expect(hero()).toHaveTextContent("You've spent and invested $1,486.20 more than came in this month.");
    expect(within(explore()).getByRole("region", { name: "Follow your money" })).toHaveTextContent("Beyond income");
  });

  it("keeps every total while the month's list is searched and filtered", async () => {
    server();
    const user = userEvent.setup();
    const { router } = renderApp("/?month=2026-11");
    await waitFor(() => {
      expect(hero()).toHaveTextContent("shared expense");
    });
    const before = hero().textContent;
    const list = () => within(explore()).getByRole("region", { name: /^Entries/ });
    expect(list()).toHaveTextContent("7 entries");

    await user.type(within(list()).getByRole("searchbox", { name: "Search this month" }), "coffee{Enter}");
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ month: "2026-11", q: "coffee" });
    });
    expect(list()).toHaveTextContent("1 entry match. The month's totals above don't change with these filters.");
    expect(within(list()).getByRole("button", { name: /Morning coffee/ })).toHaveTextContent("your share");
    expect(hero().textContent).toBe(before);

    await user.click(within(list()).getByRole("radio", { name: "Income" }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ month: "2026-11", q: "coffee", kind: "income" });
    });
    expect(list()).toHaveTextContent("Nothing this month matches “coffee”.");
    expect(hero().textContent).toBe(before);

    await user.click(within(list()).getByRole("button", { name: "Clear filters" }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ month: "2026-11" });
    });
    // The scheduled retainer is listed but labelled, and opens nothing.
    const scheduled = within(list()).getByText("Design retainer").closest("li");
    expect(scheduled).toHaveTextContent("Scheduled");
    expect(within(scheduled as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
  });

  it("filters the list by a calendar day, by keyboard, and clears it again", async () => {
    server();
    const user = userEvent.setup();
    const { router } = renderApp("/?month=2026-11");
    const calendar = await within(await screen.findByRole("region", { name: "Explore your month" })).findByRole("region", { name: "Calendar" });
    const sixth = within(calendar).getByRole("button", { name: /^Friday, November 6/ });
    expect(sixth).toHaveAccessibleName("Friday, November 6: spent $6.20");
    expect(within(calendar).getByRole("button", { name: /^Wednesday, November 25/ })).toHaveAccessibleName("Wednesday, November 25: 1 scheduled");
    await user.click(sixth);
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ month: "2026-11", day: "2026-11-06" });
    });
    expect(within(calendar).getByRole("button", { name: /^Friday, November 6/ })).toHaveAttribute("aria-pressed", "true");
    const list = within(explore()).getByRole("region", { name: "Entries · Fri, Nov 6, 2026" });
    expect(list).toHaveTextContent("1 entry");

    within(calendar).getByRole("button", { name: /^Friday, November 6/ }).focus();
    await user.keyboard("{ArrowRight}");
    expect(within(calendar).getByRole("button", { name: /^Saturday, November 7/ })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(within(calendar).getByRole("button", { name: /^Saturday, November 14/ })).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ month: "2026-11", day: "2026-11-14" });
    });
    await user.click(within(calendar).getByRole("button", { name: "Whole month" }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ month: "2026-11" });
    });
  });

  it("lists categories with amounts in text and filters the list by one", async () => {
    server();
    const user = userEvent.setup();
    const { router } = renderApp("/?month=2026-11");
    const breakdown = await within(await screen.findByRole("region", { name: "Explore your month" })).findByRole("region", { name: "By category" });
    await waitFor(() => {
      expect(within(breakdown).getAllByRole("listitem")).toHaveLength(2);
    });
    expect(within(breakdown).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Food & drinks$1,456.20 · 98%", "Utilities$30.00 · 2%"]);
    await user.click(within(breakdown).getByRole("button", { name: /Utilities/ }));
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ month: "2026-11", category: expect.stringContaining("household-category:Utilities") as unknown });
    });
    const list = within(explore()).getByRole("region", { name: /^Entries/ });
    expect(list).toHaveTextContent("1 entry match");
    expect(within(list).getByRole("link", { name: /Hydro/ })).toBeInTheDocument();
  });

  it("focuses money-flow nodes by click and keyboard, and lists every value as a table", async () => {
    server();
    const user = userEvent.setup();
    renderApp("/?month=2026-11");
    const flow = await within(await screen.findByRole("region", { name: "Explore your month" })).findByRole("region", { name: "Follow your money" });
    const diagram = within(flow).getByRole("group", { name: "Money flow diagram" });
    await waitFor(() => {
      expect(within(diagram).getAllByRole("button").length).toBeGreaterThan(3);
    });
    const salary = within(diagram).getByRole("button", { name: /^Came in: Salary/ });
    expect(salary).toHaveAccessibleName("Came in: Salary, $5,200.00, 100% of what came in");
    await user.click(salary);
    expect(salary).toHaveAttribute("aria-pressed", "true");
    expect(flow.querySelector(".flow__focus")).toHaveTextContent("Salary $5,200.00 · 100% of what came in");

    await user.keyboard("{ArrowDown}");
    const food = within(diagram).getByRole("button", { name: /^Went out: Food & drinks/ });
    expect(food).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(food).toHaveAttribute("aria-pressed", "true");
    expect(salary).toHaveAttribute("aria-pressed", "false");
    await user.keyboard("{Escape}");
    expect(food).toHaveAttribute("aria-pressed", "false");
    expect(flow.querySelector(".flow__focus")).toHaveTextContent("Nothing focused");

    expect(flow).toHaveTextContent("Came in includes $400.00 of expected recurring income not recorded yet.");
    const table = within(flow).getByRole("table", { name: "Money flow for November 2026" });
    expect(within(table).getByRole("rowheader", { name: "Left over" }).parentElement).toHaveTextContent("Went out" + "Left over" + "$3,513.80" + "68%");
  });

  it("shows the first-entry state instead of zero-value charts", async () => {
    ledgerServer();
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Your month starts with one entry" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add your first entry/ })).toHaveAttribute("href", "/entries/new");
    expect(screen.getByRole("link", { name: "Currency: CAD" })).toHaveAttribute("href", "/settings/currency");
    expect(screen.queryByRole("region", { name: "Follow your money" })).not.toBeInTheDocument();
  });

  it("changes month with Previous and Next, kept in the URL", async () => {
    const api = server();
    const user = userEvent.setup();
    const { router } = renderApp("/?month=2026-11");
    await waitFor(() => {
      expect(hero()).toHaveTextContent("shared expense");
    });
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ month: "2026-10" });
    });
    await waitFor(() => {
      expect(within(hero()).getByText("Spent · your share").parentElement).toHaveTextContent("$500.00");
    });
    expect(api.state.projections).toContain("/api/households/projection?month=2026-10");
  });
});

describe("Insights", () => {
  it("shows the month's totals, the change from last month and categories side by side", async () => {
    server();
    renderApp("/insights?month=2026-11");
    const table = await screen.findByRole("table", { name: /^Spending by category/ });
    await waitFor(() => {
      expect(within(table).getAllByRole("row")).toHaveLength(4);
    });
    const rows = within(table).getAllByRole("row").slice(1).map((row) => row.textContent);
    expect(rows).toEqual(["Food & drinks$1,456.20$0.00Up $1,456.2098%", "Utilities$30.00$0.00Up $30.0098%".replace("98%", "2%"), "Groceries$0.00$500.00Down $500.000%"]);
    const totals = within(document.querySelector(".insights__totals") as HTMLElement);
    expect(totals.getByText("vs October").nextElementSibling).toHaveTextContent("$986.20 more spent");
    expect(totals.getByText("Left over").nextElementSibling).toHaveTextContent("$3,113.80");
    expect(screen.getByRole("region", { name: "Follow your money" })).toBeInTheDocument();
  });
});
