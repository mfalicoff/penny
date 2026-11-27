import { configure, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RATES_STORAGE_KEY } from "../src/api/rates";
import { today } from "../src/features/entries/model";
import { entry, ledgerServer, personalHit, type WireEntry } from "./fakes/ledgerServer";
import { json, renderApp } from "./render";

/**
 * The entry form in another currency (MAZ-151 phase 1) inside the real app: the currency menu, the
 * live conversion, the published, provisional and edited rate, and a server with rates turned off.
 * `GET /api/rates` answers with the cards' sample rates. Synthetic data only.
 */

configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  localStorage.removeItem(RATES_STORAGE_KEY);
});

const PAST = "2026-11-03";

/** Rates in CAD: published up to yesterday, today's provisional (the latest is yesterday's). */
function rates(enabled = true) {
  return (url: string) => {
    const date = new URL(url, "http://x").searchParams.get("date") ?? today();
    if (!enabled) return json({ enabled: false, source: null, base: "CAD", date, rateDate: null, provisional: false, latestDate: null, rates: {} });
    const provisional = date >= today();
    return json({ enabled: true, source: "European Central Bank", base: "CAD", date, rateDate: provisional ? "2026-11-06" : date, provisional, latestDate: "2026-11-06", rates: provisional ? { EUR: "1.463" } : { EUR: "1.4612", JPY: "0.008953" } });
  };
}

async function openAdd(user: UserEvent) {
  await screen.findByRole("heading", { level: 1 });
  await user.keyboard("n");
  return screen.findByRole("form", { name: "New entry" });
}

async function pickCurrency(user: UserEvent, form: HTMLElement, code: string) {
  await user.click(within(form).getByRole("button", { name: /^Currency: / }));
  const menu = within(form).getByRole("dialog", { name: "Currency" });
  expect(within(menu).getByRole("searchbox", { name: "Search currencies" })).toHaveFocus();
  await user.keyboard(code.toLowerCase());
  await user.keyboard("{Enter}");
  expect(within(form).queryByRole("dialog", { name: "Currency" })).not.toBeInTheDocument();
  expect(within(form).getByRole("button", { name: new RegExp(`^Currency: ${code}`) })).toHaveFocus();
}

async function type(user: UserEvent, field: HTMLElement, value: string) {
  await user.clear(field);
  await user.type(field, value);
}

const saveButton = (form: HTMLElement) => within(form).getByRole("button", { name: /^(Save|Add expense)/ });

describe("an entry in another currency", () => {
  it("picks euros from the menu, converts as you type and saves the published rate", async () => {
    const server = ledgerServer({}, { rates: rates() });
    const user = userEvent.setup();
    renderApp("/");
    const form = await openAdd(user);
    await type(user, within(form).getByLabelText("Date"), PAST);
    await type(user, within(form).getByLabelText("Amount (CAD)"), "85.555");
    await pickCurrency(user, form, "EUR");
    // Digits beyond the euro's two decimals are dropped, and the symbol follows the currency.
    expect(within(form).getByLabelText("Amount (EUR)")).toHaveValue("85.55");
    await type(user, within(form).getByLabelText("Amount (EUR)"), "85");
    expect(await within(form).findByText("≈ $124.20 CAD")).toBeInTheDocument();
    expect(within(form).getByText("1 EUR = 1.4612 CAD")).toBeInTheDocument();
    expect(within(form).getByText(/European Central Bank · Nov 3/)).toBeInTheDocument();
    await type(user, within(form).getByLabelText("Title"), "Cooking class");

    await user.click(saveButton(form));
    await screen.findByText("Expense added");
    await waitFor(() => {
      expect(server.state.ledger.transactions.find((item) => item.title === "Cooking class")).toMatchObject({ total: 12420, share: 12420, originalAmount: 8500, originalCurrency: "EUR", rate: "1.4612", rateStatus: "published", rateDate: PAST });
    });
  });

  it("drops the decimals for a currency without minor units, and closes the menu on Escape", async () => {
    ledgerServer({}, { rates: rates() });
    const user = userEvent.setup();
    renderApp("/");
    const form = await openAdd(user);
    await type(user, within(form).getByLabelText("Date"), PAST);
    await type(user, within(form).getByLabelText("Amount (CAD)"), "1200.50");
    await user.click(within(form).getByRole("button", { name: /^Currency: / }));
    const menu = within(form).getByRole("dialog", { name: "Currency" });
    expect(within(menu).getByRole("button", { name: "JPY, Japanese yen, No decimals" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(within(form).queryByRole("dialog", { name: "Currency" })).not.toBeInTheDocument();
    expect(screen.getByRole("form", { name: "New entry" })).toBeInTheDocument();
    await pickCurrency(user, form, "JPY");
    expect(within(form).getByLabelText("Amount (JPY)")).toHaveValue("1,200");
    expect(await within(form).findByText("≈ $10.74 CAD")).toBeInTheDocument();
  });

  it("marks today's rate provisional, and keeps a rate the person edits", async () => {
    const server = ledgerServer({}, { rates: rates() });
    const user = userEvent.setup();
    renderApp("/");
    const form = await openAdd(user);
    await pickCurrency(user, form, "EUR");
    await type(user, within(form).getByLabelText("Amount (EUR)"), "48");
    await type(user, within(form).getByLabelText("Title"), "Museum passes");
    expect(await within(form).findByText("≈ $70.22 CAD")).toBeInTheDocument();
    expect(within(form).getByText("Provisional")).toBeInTheDocument();
    expect(within(form).getByText(/^Today's rate isn't out yet, so Penny uses Friday's\./)).toBeInTheDocument();

    await user.click(within(form).getByRole("button", { name: /^Edit the rate/ }));
    const rate = within(form).getByRole("textbox", { name: "Exchange rate: CAD for 1 EUR" });
    await waitFor(() => {
      expect(rate).toHaveFocus();
    });
    expect(rate).toHaveValue("1.4630");
    await type(user, rate, "1.49");
    expect(within(form).getByText("Edited")).toBeInTheDocument();
    expect(within(form).getByText("≈ $71.52 CAD")).toBeInTheDocument();
    expect(within(form).getByText("European Central Bank: 1.4630")).toBeInTheDocument();
    // Use it goes back to the published rate; edit again and save the edited one.
    await user.click(within(form).getByRole("button", { name: "Use it" }));
    expect(within(form).getByText("≈ $70.22 CAD")).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: /^Edit the rate/ }));
    await type(user, within(form).getByRole("textbox", { name: "Exchange rate: CAD for 1 EUR" }), "1.49");
    await user.click(saveButton(form));
    await screen.findByText("Expense added");
    await waitFor(() => {
      expect(server.state.ledger.transactions.find((item) => item.title === "Museum passes")).toMatchObject({ total: 7152, rate: "1.49", rateStatus: "edited" });
    });
    expect(server.state.ledger.transactions.find((item) => item.title === "Museum passes")).not.toHaveProperty("rateDate");
  });

  it("with rates off, requires a rate before saving and suggests the last one", async () => {
    const last: WireEntry = entry("old", "Tapas", { date: "2026-10-20", total: 2920, share: 2920, originalAmount: 2000, originalCurrency: "EUR", rate: "1.46", rateStatus: "edited" });
    const server = ledgerServer({ transactions: [last] }, { rates: rates(false) });
    const user = userEvent.setup();
    renderApp("/");
    const form = await openAdd(user);
    await pickCurrency(user, form, "EUR");
    await type(user, within(form).getByLabelText("Amount (EUR)"), "85");
    await type(user, within(form).getByLabelText("Title"), "Cooking class");
    expect(await within(form).findByText("Enter a rate to convert")).toBeInTheDocument();
    expect(within(form).getByText(/Your server doesn't fetch exchange rates\./)).toBeInTheDocument();
    expect(saveButton(form)).toHaveAttribute("aria-disabled", "true");

    await user.click(saveButton(form));
    expect(await within(form).findByText("Enter the exchange rate.")).toBeInTheDocument();
    expect(within(form).getByRole("textbox", { name: "Exchange rate: CAD for 1 EUR" })).toHaveAttribute("aria-invalid", "true");
    expect(server.state.puts).toBe(0);

    await user.click(within(form).getByRole("button", { name: "use your last one (1.4600)" }));
    expect(within(form).getByRole("textbox", { name: "Exchange rate: CAD for 1 EUR" })).toHaveValue("1.4600");
    expect(within(form).getByText("≈ $124.10 CAD")).toBeInTheDocument();
    expect(saveButton(form)).not.toHaveAttribute("aria-disabled");
    await user.click(saveButton(form));
    await screen.findByText("Expense added");
    await waitFor(() => {
      expect(server.state.ledger.transactions.find((item) => item.title === "Cooking class")).toMatchObject({ total: 12410, rate: "1.46", rateStatus: "edited" });
    });
  });

  it("can't repeat in another currency", async () => {
    ledgerServer({}, { rates: rates() });
    const user = userEvent.setup();
    renderApp("/");
    const form = await openAdd(user);
    await pickCurrency(user, form, "EUR");
    const extras = within(form).queryByRole("button", { name: /^Receipt, repeat, trip/ });
    if (extras) await user.click(extras);
    const weekly = within(form).queryByRole("radio", { name: "Weekly" });
    if (weekly) expect(weekly).toBeDisabled();
    else expect(within(form).getByRole("combobox", { name: "Repeat" })).toBeDisabled();
  });

  it("restores an entry in another currency for editing and keeps its rate", async () => {
    const saved = entry("cook", "Cooking class", { date: PAST, total: 12420, share: 12420, categoryId: "food", originalAmount: 8500, originalCurrency: "EUR", rate: "1.4612", rateStatus: "published", rateDate: PAST });
    const server = ledgerServer({ transactions: [saved] }, { rates: rates(), search: () => [personalHit(saved)] });
    const user = userEvent.setup();
    renderApp("/transactions?month=2026-11");
    const row = await screen.findByRole("button", { name: /^Cooking class/ });
    await waitFor(() => {
      expect(row).toHaveTextContent("−$124.20");
    });
    expect(row).toHaveTextContent("€85.00");
    await user.click(row);
    const detail = await screen.findByRole("dialog", { name: "Cooking class" }).catch(() => screen.getByRole("complementary", { name: "Cooking class" }));
    expect(detail).toHaveTextContent("−€85.00");
    expect(within(detail).getByRole("heading", { name: "Exchange rate" })).toBeInTheDocument();
    expect(detail).toHaveTextContent("Your totals use $124.20. To use your card's rate instead, edit the entry and change its rate.");
    await user.click(within(detail).getByRole("button", { name: "Edit" }));
    const form = await screen.findByRole("form", { name: "Edit entry" });
    expect(within(form).getByLabelText("Amount (EUR)")).toHaveValue("85.00");
    expect(within(form).getByText("1 EUR = 1.4612 CAD")).toBeInTheDocument();
    await type(user, within(form).getByLabelText("Title"), "Cooking class in Alfama");
    await user.click(within(form).getByRole("button", { name: /^Save/ }));
    await waitFor(() => {
      expect(server.state.ledger.transactions[0]).toMatchObject({ title: "Cooking class in Alfama", total: 12420, originalAmount: 8500, rate: "1.4612", rateStatus: "published", rateDate: PAST });
    });
  });
});
