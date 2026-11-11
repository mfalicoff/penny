import { onlineManager } from "@tanstack/react-query";
import { configure, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { entry, ledgerServer, personalHit, setOnline, sharedHit, sharedRow } from "./fakes/ledgerServer";
import { renderApp } from "./render";

/**
 * Activity at `/transactions` (MAZ-88): period totals with shared shares, URL-backed filters,
 * shared rows next to personal ones online and from cache offline. Synthetic data only.
 */
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
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

const totals = () => screen.getByRole("region", { name: "November 2026" });
const results = () => screen.getByRole("region", { name: "Search results" });

describe("Activity", () => {
  it("totals the month from personal entries and your shared shares, whatever the search or filters", async () => {
    const api = server(() => [personalHit(pay)]);
    renderApp("/transactions?month=2026-11&kind=income&q=salary");
    expect(await within(await screen.findByRole("region", { name: "Search results" })).findByText("Monthly salary")).toBeInTheDocument();
    await waitFor(() => {
      expect(within(totals()).getByText("Spent").nextElementSibling).toHaveTextContent("$1,552.35");
    });
    expect(within(totals()).getByText("Earned").nextElementSibling).toHaveTextContent("$4,800.00");
    expect(within(totals()).getByText("Invested").nextElementSibling).toHaveTextContent("$200.00");
    expect(within(totals()).getByText("Left").nextElementSibling).toHaveTextContent("+$3,047.65");
    expect(totals()).toHaveTextContent("Spent includes your share of 1 shared expense.");
    expect(api.state.searches).toContainEqual({ query: "salary", from: "2026-11-01", to: "2026-11-30", kind: "income", pageSize: 50 });
    expect(api.state.projections).toContain("/api/households/projection?month=2026-11");
  });

  it("marks income dated after today as expected, but not a future-dated expense (MAZ-136)", async () => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const tomorrow = `${String(next.getFullYear())}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
    const bonus = entry("bonus", "Year-end bonus", { kind: "income", categoryId: "salary", total: 50000, share: 50000, date: tomorrow });
    const tickets = entry("tickets", "Concert tickets", { total: 9000, share: 9000, date: tomorrow, categoryId: "food" });
    ledgerServer({ transactions: [bonus, tickets] }, { shared: [], search: () => [personalHit(bonus), personalHit(tickets)] });
    renderApp(`/transactions?month=${tomorrow.slice(0, 7)}`);
    const row = await within(await screen.findByRole("region", { name: "Search results" })).findByRole("button", { name: /Year-end bonus/ });
    expect(row).toHaveTextContent("Expected");
    expect(row.querySelector(".category-dot--expected")).not.toBeNull();
    expect(row).toHaveTextContent("expected");
    const expense = within(results()).getByRole("button", { name: /Concert tickets/ });
    expect(expense).not.toHaveTextContent("Expected");
    expect(expense.querySelector(".category-dot--expected")).toBeNull();
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
    server(() => []);
    renderApp("/transactions?month=2026-11");
    // Online and up to date: the server's search (which returns nothing here).
    expect(await screen.findByText("No matching transactions.")).toBeInTheDocument();
    await waitFor(() => {
      expect(totals()).toHaveTextContent("shared expense");
    });
    setOnline(false);
    expect(await screen.findByText("5 matching transactions on this device")).toBeInTheDocument();
    expect(within(results()).getByRole("link", { name: /Hydro/ })).toBeInTheDocument();
    expect(results()).toHaveTextContent("Shared expenses are as Penny last loaded them");
    expect(within(results()).queryByText("October groceries")).not.toBeInTheDocument();
    expect(totals()).toHaveTextContent("as Penny last loaded them");
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

    await user.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ month: "2026-12", kind: "expense" });
    });
    expect(screen.getByRole("region", { name: "December 2026" })).toBeInTheDocument();

    history.back();
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ month: "2026-11", kind: "expense" });
    });
    expect(screen.getByRole("radio", { name: "Expenses" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "Year" }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ year: "2026", kind: "expense" });
    });
    expect(api.state.searches).toContainEqual({ from: "2026-01-01", to: "2026-12-31", kind: "expense", pageSize: 50 });

    const day = screen.getByLabelText("Day");
    await user.type(day, "2026-11-06");
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ year: "2026", day: "2026-11-06" });
    });
    expect(api.state.searches).toContainEqual({ from: "2026-11-06", to: "2026-11-06", kind: "expense", pageSize: 50 });

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ year: "2026" });
    });
  });

  it("filters by a frequent category inline or any category from All categories, including shared rows by name", async () => {
    server();
    const user = userEvent.setup();
    const { router } = renderApp("/transactions?month=2026-11");
    await within(await screen.findByRole("region", { name: "Search results" })).findByText("Rent");
    const chips = await screen.findByRole("group", { name: "Category" });
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

  it("says when nothing matches a search", async () => {
    server(() => []);
    renderApp("/transactions?q=zzz");
    expect(await screen.findByRole("heading", { name: "Nothing matches “zzz”" })).toBeInTheDocument();
    expect(screen.getByText("No matching transactions.")).toBeInTheDocument();
  });
});
