import { onlineManager } from "@tanstack/react-query";
import { act, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entry, ledgerServer, sharedRow } from "./fakes/ledgerServer";
import { reloadPreferences, setPreferences } from "../src/app/preferences";
import { renderApp } from "./render";

/**
 * Home, Money flow and Insights (MAZ-92, MAZ-224) in the real app over the durable ledger: recorded
 * and projected remaining, shared shares, the calendar sheet, categories, the money flow by
 * keyboard, and the first-entry state. Synthetic data only.
 */
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 20_000 });

// The clock is pinned to Wed Nov 11, 2026, local noon, so the month's recorded entries (Nov 1–7) are
// before today, the Nov 20 and Nov 25 schedules are still ahead (not yet recorded by the recurrence
// runner), and the totals hold on any day CI runs.
const TODAY = new Date("2026-11-11T12:00:00");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  reloadPreferences();
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

/**
 * A window this wide (MAZ-174): `min-width` queries answer for it, so the desktop layouts render.
 * Without it jsdom has no `matchMedia` and the app lays out for a phone.
 */
function stubWidth(width: number, { touch = false }: { touch?: boolean } = {}) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      // A touch tablet query (ipad-home) matches only when `touch` is set.
      if (query.includes("pointer: coarse")) return { matches: touch && (!min || width >= Number(min[1])), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() };
      return { matches: min ? width >= Number(min[1]) : query.includes("hover"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    }),
  );
}

/** The headings of the page's regions in document order, for checking what leads. */
const regionOrder = () => screen.getAllByRole("region").map((region) => region.getAttribute("aria-labelledby") && document.getElementById(region.getAttribute("aria-labelledby") ?? "")?.textContent);

const hero = () => screen.getByRole("region", { name: "Left to spend" });
const recorded = () => within(hero()).getByText(/^Recorded remaining:/).parentElement;
const projected = () => within(hero()).getByText(/^Projected remaining:/).parentElement;

/** Waits for the month with its shared share (Left to spend includes Hydro's $30.00). */
async function loaded() {
  await waitFor(() => {
    expect(recorded()).toHaveTextContent("$3,113.80");
  });
}

describe("Home", () => {
  it("on desktop, leads with recorded remaining and the card's short projected line (MAZ-224)", async () => {
    stubWidth(1440);
    const api = server();
    renderApp("/?month=2026-11");
    await loaded();
    // 4,800.00 − (1,450.00 + 6.20 + 30.00) − 200.00, then + 400.00 expected income − 8.00 scheduled shared share
    expect(projected()).toHaveTextContent("$3,505.80");
    expect(hero()).toHaveTextContent("$3,505.80 projected · includes $400.00 expected pay on Nov 25");
    // web-home has no "Recorded so far" line (MAZ-224).
    expect(hero()).not.toHaveTextContent("Recorded so far");
    expect(within(hero()).getByText("Came in").parentElement).toHaveTextContent("$4,800.00");
    expect(within(hero()).getByText("Spent · your share").parentElement).toHaveTextContent("$1,486.20");
    expect(within(hero()).getByText("Invested").parentElement).toHaveTextContent("$200.00");
    expect(api.state.projections).toContain("/api/households/projection?month=2026-11");

    const coming = screen.getByRole("region", { name: "Coming up" });
    expect(within(coming).getAllByRole("listitem").map((item) => item.textContent)).toEqual([expect.stringContaining("Streaming"), expect.stringContaining("Design retainer")]);
  });

  it("signs Recent amounts as the cards do: expenses minus, income plus, investments unsigned (MAZ-202)", async () => {
    server();
    renderApp("/?month=2026-11");
    const recent = await screen.findByRole("region", { name: "Recent" });
    const amountOf = async (title: string) => (await within(recent).findByText(title)).closest("li")?.querySelector(".results__amount .money")?.textContent;
    expect(await amountOf("Rent")).toBe("−$1,450.00");
    expect(await amountOf("Morning coffee")).toBe("−$6.20");
    expect(await amountOf("Hydro")).toBe("−$30.00");
    expect(await amountOf("Monthly salary")).toBe("+$4,800.00 income");
    expect(await amountOf("Index fund")).toBe("$200.00 invested");
  });

  it("on a phone, shows only the hero, Follow your money and Recent, as iphone-home (MAZ-174, MAZ-224)", async () => {
    server();
    renderApp("/?month=2026-11");
    await loaded();
    expect(hero()).toHaveTextContent("$3,505.80 projected with expected pay");
    expect(hero()).not.toHaveTextContent("Recorded so far");
    // One number leads: the tiles are the desktop card's; the flow card carries the split instead.
    expect(within(hero()).queryByText("Came in")).not.toBeInTheDocument();
    expect(regionOrder()).toEqual(["Left to spend", "Follow your money", "Recent"]);
    const flow = screen.getByRole("region", { name: "Follow your money" });
    // The compact legend shows whole units, as on the card ("Spent $1,883").
    expect(within(flow).getByText("Spent").parentElement).toHaveTextContent("$1,486");
    expect(within(flow).getByRole("link", { name: "Follow your money" })).toHaveAttribute("href", "/money-flow?month=2026-11");
    expect(within(flow).getByRole("link", { name: "Insights" })).toHaveAttribute("href", "/insights?month=2026-11");
    const recent = screen.getByRole("region", { name: "Recent" });
    expect(within(recent).getByRole("link", { name: /Hydro/ })).toHaveAttribute("href", "/households/h1/expenses/e1");
    expect(within(recent).getByRole("link", { name: "See all" })).toHaveAttribute("href", "/transactions?month=2026-11");
    expect(within(recent).queryByText("October groceries")).not.toBeInTheDocument();
    // The top row is the card's glass month pill, calendar and settings buttons (MAZ-221).
    const topbar = screen.getByRole("banner");
    expect(within(topbar).getByRole("combobox", { name: "Month" })).toHaveValue("2026-11");
    expect(within(topbar).getByRole("button", { name: "Calendar" })).toBeInTheDocument();
    expect(within(topbar).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("on desktop, puts the Sankey and By category under the hero and the month in the top bar, as web-home (MAZ-174, MAZ-224)", async () => {
    stubWidth(1440);
    server();
    renderApp("/?month=2026-11");
    await loaded();
    expect(regionOrder()).toEqual(["Left to spend", "Coming up", "Follow your money", "By category"]);
    const flow = screen.getByRole("region", { name: "Follow your money" });
    expect(flow).toHaveTextContent("Select a band or label to focus it, again to clear");
    expect(within(flow).getByRole("link", { name: "Open full view" })).toHaveAttribute("href", "/insights?month=2026-11");
    expect(within(flow).getByText("Show as a table")).toBeInTheDocument();
    const breakdown = screen.getByRole("region", { name: "By category" });
    expect(within(breakdown).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Food & drinks$1,456.20, 98% of spending", "Utilities$30.00, 2% of spending"]);
    expect(within(breakdown).queryByRole("button")).not.toBeInTheDocument();
    const topbar = screen.getByRole("banner");
    expect(within(topbar).getByRole("button", { name: "Previous month" })).toBeInTheDocument();
    expect(within(topbar).getByText("November 2026", { selector: ".month-nav__label" })).toBeInTheDocument();
    expect(within(screen.getByRole("main")).queryByRole("button", { name: "Previous month" })).not.toBeInTheDocument();
  });

  it("reads Recent rows as the card does, date first, and signs Coming up (MAZ-223)", async () => {
    server();
    renderApp("/?month=2026-11");
    const recent = await screen.findByRole("region", { name: "Recent" });
    const metaOf = async (title: string) => (await within(recent).findByText(title)).closest("li")?.querySelector(".results__meta")?.textContent;
    // iphone-home: "Today · Main chequing"; the category is the row's icon, not its subtitle.
    expect(await metaOf("Morning coffee")).toBe("Nov 6");
    expect(await metaOf("Hydro")).toMatch(/^Nov 3 · /);
    expect(await metaOf("Hydro")).not.toContain("Utilities");
    // The flow card's Insights is a pill link, not a copper text link.
    expect(within(screen.getByRole("region", { name: "Follow your money" })).getByRole("link", { name: "Insights" })).toHaveClass("home-flow__insights");
  });

  it("signs Coming up amounts as web-home does (MAZ-223)", async () => {
    stubWidth(1440);
    server();
    renderApp("/?month=2026-11");
    const coming = await screen.findByRole("region", { name: "Coming up" });
    const amount = (title: string) => within(coming).getByText(title).closest("li")?.querySelector(".coming__amount")?.textContent;
    expect(amount("Streaming")).toBe("−$8.00");
    expect(amount("Design retainer")).toBe("+$400.00 income");
    // web-home: the totals under the hero are in the label color; only their dots carry meaning.
    expect(within(hero()).getByText("Came in").parentElement?.querySelector(".money")).not.toHaveClass("pk-money--income");
  });

  it("on a touch tablet, shows the one-line legend and Daily spending, as ipad-home (MAZ-223)", async () => {
    stubWidth(1194, { touch: true });
    server();
    renderApp("/?month=2026-11");
    await loaded();
    expect(regionOrder()).toEqual(["Left to spend", "Coming up", "Follow your money", "Daily spending"]);
    expect(within(hero()).getByText("Income").parentElement).toHaveTextContent("$4,800.00");
    expect(within(hero()).queryByText("Came in")).not.toBeInTheDocument();
    const daily = screen.getByRole("region", { name: "Daily spending" });
    // $1,486.20 over November's 30 days; each day with spending is listed for screen readers.
    expect(daily).toHaveTextContent("Avg $49.54");
    expect(within(daily).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Nov 1: $1,450.00", "Nov 3: $30.00", "Nov 6: $6.20"]);
  });

  it("emphasises the band under the pointer without selecting it, as web-home (MAZ-223)", async () => {
    stubWidth(1440);
    server();
    renderApp("/?month=2026-11");
    const flow = await screen.findByRole("region", { name: "Follow your money" });
    const diagram = within(flow).getByRole("group", { name: "Money flow diagram" });
    await waitFor(() => {
      expect(within(diagram).getAllByRole("button").length).toBeGreaterThan(3);
    });
    const salary = within(diagram).getByRole("button", { name: /^Came in: Salary/ });
    // Sankey labels carry the currency, as on the cards.
    expect(salary).toHaveTextContent("$4,800.00");
    fireEvent.pointerEnter(salary, { pointerType: "mouse" });
    expect(salary).toHaveClass("flow-node--lit");
    expect(salary).toHaveAttribute("aria-pressed", "false");
    expect(within(diagram).getByRole("button", { name: /^Went out: Food & drinks/ })).toHaveClass("flow-node--dim");
    expect(flow).toHaveTextContent("Select a band or label to focus it, again to clear");
    expect(flow).not.toHaveTextContent("selected");
    fireEvent.pointerLeave(salary, { pointerType: "mouse" });
    expect(salary).not.toHaveClass("flow-node--lit");
  });

  it("names the focused band in the desktop flow card's hint", async () => {
    stubWidth(1440);
    server();
    const user = userEvent.setup();
    renderApp("/?month=2026-11");
    const flow = await screen.findByRole("region", { name: "Follow your money" });
    const diagram = within(flow).getByRole("group", { name: "Money flow diagram" });
    await waitFor(() => {
      expect(within(diagram).getAllByRole("button").length).toBeGreaterThan(3);
    });
    await user.click(within(diagram).getByRole("button", { name: /^Came in: Salary/ }));
    expect(flow).toHaveTextContent("Salary selected · select a band or label to focus it, again to clear");
  });

  it("says when the month is overspent, in words", async () => {
    server([rent, coffee]);
    renderApp("/?month=2026-11");
    expect(await within(await screen.findByRole("region", { name: "Left to spend" })).findByText("Overspent")).toBeInTheDocument();
    expect(hero()).toHaveTextContent("You've spent and invested $1,486.20 more than came in this month.");
    expect(screen.getByRole("region", { name: "Follow your money" })).toHaveTextContent("Beyond income");
  });

  it("opens the calendar as a sheet over Home, lists a day's entries and moves by keyboard (MAZ-224)", async () => {
    server();
    const user = userEvent.setup();
    const { router } = renderApp("/?month=2026-11");
    await loaded();
    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Calendar" }));
    const sheet = await screen.findByRole("dialog", { name: "November 2026" });
    const sixth = within(sheet).getByRole("button", { name: /^Friday, November 6/ });
    expect(sixth).toHaveAccessibleName("Friday, November 6: spent $6.20");
    expect(within(sheet).getByRole("button", { name: /^Wednesday, November 25/ })).toHaveAccessibleName("Wednesday, November 25: 1 expected or scheduled");
    // The legend reads "Scheduled" as on the card (MAZ-223); each day's name says "expected or scheduled".
    expect(within(sheet).getByRole("list", { name: "Legend" })).toHaveTextContent("Scheduled");
    expect(within(sheet).getByRole("list", { name: "Legend" })).not.toHaveTextContent("Expected");
    expect(sheet).toHaveTextContent("Choose a day to see its entries.");

    await user.click(sixth);
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ month: "2026-11", day: "2026-11-06" });
    });
    expect(within(sheet).getByRole("button", { name: /^Friday, November 6/ })).toHaveAttribute("aria-pressed", "true");
    const day = within(sheet).getByRole("region", { name: /^Friday, Nov/ });
    expect(day).toHaveTextContent("−$6.20");
    expect(within(day).getByRole("button", { name: /Morning coffee/ })).toBeInTheDocument();
    // Under the day's heading the row leaves the date out (iphone-calendar: "Visa · monthly"); with no account it names the category.
    expect(within(day).getByRole("button", { name: /Morning coffee/ }).querySelector(".results__meta")).toHaveTextContent(/^Food & drinks$/);

    within(sheet).getByRole("button", { name: /^Friday, November 6/ }).focus();
    await user.keyboard("{ArrowRight}");
    expect(within(sheet).getByRole("button", { name: /^Saturday, November 7/ })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(within(sheet).getByRole("button", { name: /^Saturday, November 14/ })).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ month: "2026-11", day: "2026-11-14" });
    });
    expect(within(sheet).getByRole("region", { name: /^Saturday, Nov/ })).toHaveTextContent("Nothing on this day.");

    await user.click(within(sheet).getByRole("button", { name: "Previous month" }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ month: "2026-10" });
    });
    expect(await screen.findByRole("dialog", { name: "October 2026" })).toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Today" }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ day: "2026-11-11" });
    });
    await user.click(within(screen.getByRole("dialog", { name: "November 2026" })).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(router.state.location.search).toEqual({});
  });

  it("opens the calendar sheet from a link with a day", async () => {
    server();
    renderApp("/?month=2026-11&day=2026-11-06");
    const sheet = await screen.findByRole("dialog", { name: "November 2026" });
    expect(await within(sheet).findByRole("button", { name: /Morning coffee/ })).toBeInTheDocument();
  });

  it("follows Show cents and Week starts on from Settings › Appearance", async () => {
    server();
    setPreferences({ showCents: false, weekStartsOn: "sunday" });
    const user = userEvent.setup();
    renderApp("/?month=2026-11");
    await waitFor(() => {
      expect(recorded()).toHaveTextContent("$3,114");
    });
    // Only the hero's Left to spend is rounded; the projected line keeps its cents.
    expect(recorded()).not.toHaveTextContent("$3,113.80");
    expect(projected()).toHaveTextContent("$3,505.80");
    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Calendar" }));
    const calendar = await screen.findByRole("dialog", { name: "November 2026" });
    expect(within(calendar).getAllByRole("columnheader").map((header) => header.getAttribute("abbr"))).toEqual(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
    // 2026-11-01 is a Sunday: the 1st opens the first row when the week starts on Sunday.
    const firstRow = within(calendar).getAllByRole("row")[1];
    expect(firstRow && within(firstRow).getAllByRole("cell")[0]).toHaveTextContent("1");

    act(() => {
      setPreferences({ showCents: true, weekStartsOn: "monday" });
    });
    expect(recorded()).toHaveTextContent("$3,113.80");
    expect(within(calendar).getAllByRole("columnheader")[0]).toHaveAttribute("abbr", "Monday");
  });

  it("shows the first-entry state instead of zero-value charts", async () => {
    ledgerServer();
    renderApp("/");
    const start = await screen.findByRole("region", { name: "Add your first entry" });
    // iphone-empty-home: a muted "$0", with no cents.
    expect(hero().querySelector(".hero__amount")).toHaveTextContent(/^\$0$/);
    expect(hero()).toHaveTextContent("Your month fills in as you add entries.");
    // iphone-empty-home has no Currency link (MAZ-224); Settings › Currency chooses it.
    expect(within(start).queryByRole("link")).not.toBeInTheDocument();
    expect(within(start).getAllByRole("button").map((button) => button.textContent)).toEqual(["IncomePay, refunds", "ExpenseSpending", "InvestContributions"]);
    expect(screen.getByRole("region", { name: "Recent" })).toHaveTextContent("Nothing yet. New entries show up here.");
    expect(screen.queryByRole("region", { name: "Follow your money" })).not.toBeInTheDocument();
  });

  it("opens Add entry on the kind chosen from the empty month (MAZ-174)", async () => {
    ledgerServer();
    const user = userEvent.setup();
    renderApp("/");
    const start = await screen.findByRole("region", { name: "Add your first entry" });
    await user.click(within(start).getByRole("button", { name: /^Income/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: "Income" })).toBeChecked();
  });

  it("changes month with Previous and Next, kept in the URL, with no This month link (MAZ-224)", async () => {
    stubWidth(1440);
    const api = server();
    const user = userEvent.setup();
    const { router } = renderApp("/?month=2026-11");
    await loaded();
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ month: "2026-10" });
    });
    await waitFor(() => {
      expect(within(hero()).getByText("Spent · your share").parentElement).toHaveTextContent("$500.00");
    });
    expect(screen.queryByRole("button", { name: "This month" })).not.toBeInTheDocument();
    expect(api.state.projections).toContain("/api/households/projection?month=2026-10");
  });
});

describe("Money flow", () => {
  it("is its own screen with the totals, the Sankey, a focus card and every value as a table (iphone-money-flow, MAZ-224)", async () => {
    server();
    const user = userEvent.setup();
    renderApp("/money-flow?month=2026-11");
    expect(await screen.findByRole("heading", { level: 1, name: "Money flow" })).toBeInTheDocument();
    expect(screen.getByText("From coming in to going out")).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/");
    const diagram = await screen.findByRole("group", { name: "Money flow diagram" });
    await waitFor(() => {
      expect(within(diagram).getAllByRole("button").length).toBeGreaterThan(3);
    });
    const main = screen.getByRole("main");
    const salary = within(diagram).getByRole("button", { name: /^Came in: Salary/ });
    expect(salary).toHaveAccessibleName("Came in: Salary, $4,800.00, 100% of income");
    expect(main).toHaveTextContent("Select a band or label to focus it, again to clear");
    await user.click(salary);
    expect(salary).toHaveAttribute("aria-pressed", "true");
    const focus = () => main.querySelector(".flow__focus");
    expect(focus()).toHaveTextContent("Salary · $4,800.00100% of income");

    await user.keyboard("{ArrowDown}");
    const food = within(diagram).getByRole("button", { name: /^Went out: Food & drinks/ });
    expect(food).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(food).toHaveAttribute("aria-pressed", "true");
    expect(salary).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "Clear focus on Food & drinks" }));
    expect(food).toHaveAttribute("aria-pressed", "false");
    expect(focus()).not.toBeInTheDocument();
    await user.click(salary);
    await user.keyboard("{Escape}");
    expect(salary).toHaveAttribute("aria-pressed", "false");

    // Recorded-only (MAZ-136): the scheduled $400.00 retainer is not in Came in, and Left over is Left to spend.
    expect(within(main).getByText("Came in", { selector: "dt" }).nextElementSibling).toHaveTextContent("$4,800.00");
    expect(within(main).getByText("Left over", { selector: "dt" }).nextElementSibling).toHaveTextContent("$3,113.80");
    const table = within(main).getByRole("table", { name: "Money flow for November 2026", hidden: true });
    expect(within(table).getByRole("rowheader", { name: "Left over", hidden: true }).parentElement).toHaveTextContent("Went out" + "Left over" + "$3,113.80" + "65%");
  });
});

describe("Insights", () => {
  it("shows the month's totals, the change from last month and categories side by side", async () => {
    stubWidth(1440);
    const api = server();
    renderApp("/insights?month=2026-11");
    const table = await screen.findByRole("table", { name: /^Spending by category/ });
    await waitFor(() => {
      expect(within(table).getAllByRole("row")).toHaveLength(4);
    });
    const rows = within(table).getAllByRole("row").slice(1).map((row) => row.textContent);
    // The Change column draws arrows, as on web-insights; the words are for screen readers.
    expect(rows).toEqual(["Food & drinks$1,456.20$0.00↑Up $1,456.2098%", "Utilities$30.00$0.00↑Up $30.002%", "Groceries$0.00$500.00↓Down $500.000%"]);
    // web-insights draws the table without a visible title (MAZ-224).
    expect(screen.getByRole("heading", { name: "Spending by category" })).toHaveClass("visually-hidden");
    const totals = within(document.querySelector(".insights__totals") as HTMLElement);
    expect(totals.getByText("vs October").nextElementSibling).toHaveTextContent("$986.20 more spent");
    expect(totals.getByText("Left over").nextElementSibling).toHaveTextContent("$3,113.80");
    const flow = screen.getByRole("region", { name: "Follow your money" });
    expect(flow).toHaveTextContent("Select a band or label to focus it, again to clear");
    expect(within(flow).getByText("Show as a table")).toBeInTheDocument();

    // Last 6 months (web-insights, MAZ-174): recorded income and your share of spending.
    const months = screen.getByRole("region", { name: "Last 6 months" });
    const sixTable = await within(months).findByRole("table", { hidden: true });
    expect(within(sixTable).getAllByRole("row", { hidden: true }).slice(1).map((row) => row.textContent)).toEqual([
      "June 2026$0.00 income$0.00",
      "July 2026$0.00 income$0.00",
      "August 2026$0.00 income$0.00",
      "September 2026$0.00 income$0.00",
      "October 2026$0.00 income$500.00",
      "November 2026$4,800.00 income$1,486.20",
    ]);
    expect(api.state.projections).toContain("/api/households/projection?month=2026-06");
  });

  it("on a phone, shows the category donut, one month-over-month sentence and the categories, as iphone-insights (MAZ-174, MAZ-224)", async () => {
    server();
    renderApp("/insights?month=2026-11");
    const spending = await screen.findByRole("region", { name: "Spending" });
    await waitFor(() => {
      expect(spending).toHaveTextContent("$986.20 more than October");
    });
    expect(spending).toHaveTextContent("$1,486.20Spent");
    // "Spending · your share" is the screen's subtitle, not a card header (MAZ-223).
    expect(screen.getByText("Spending · your share")).toHaveClass("page__subtitle");
    expect(spending).not.toHaveTextContent("Your share");
    expect(spending).toHaveTextContent("Mostly Food & drinks and Utilities.");
    // The money flow is its own screen, opened from Home.
    expect(regionOrder()).toEqual(["Spending", "Categories"]);
    const categories = screen.getByRole("region", { name: "Categories" });
    expect(within(categories).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Food & drinks$1,456.20, 98%", "Utilities$30.00, 2%"]);
    expect(screen.queryByRole("region", { name: "Last 6 months" })).not.toBeInTheDocument();
  });
});
