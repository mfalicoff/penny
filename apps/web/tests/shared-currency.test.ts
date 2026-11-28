// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Ledger } from "@domain/ledger.ts";
import type { SharedRow } from "../src/api/projection";
import { memberHomeAmountsSchema, projectedExpenseSchema, sharedExpenseSchema, type SharedExpense } from "../src/api/schemas";
import { formatCents } from "../src/design/Money";
import { dayTotal, periodTotals } from "../src/features/activity/data";
import { menuSections } from "../src/features/entries/currency";
import { ledgerWithShared } from "../src/features/home/model";
import { convertSigned } from "../src/domain/households.ts";
import { currenciesPaidIn, currencyPlural, homeAmountsOf, listCodes, paidOf } from "../src/features/households/sharedCurrency";
import { homeTripTotals } from "../src/features/trips/model";

// MAZ-151 phase 2: the web's wiring around the shared rules for households and trips in any
// currency, checked against contracts/fixtures/shared-currency.json. Synthetic data only.

interface Fixture {
  settleIn: { name: string; balances: { userId: string; balanceCents: number }[]; from: string; to: string; rate: string; expected?: { balances: { userId: string; balanceCents: number }[]; suggestions: { fromUserId: string; toUserId: string; amountCents: number }[] } }[];
  projection: { ledger: Ledger; rows: Record<string, unknown>[]; expected: Record<string, unknown>[] };
}
const fixture = JSON.parse(readFileSync(new URL("../../../contracts/fixtures/shared-currency.json", import.meta.url), "utf8")) as Fixture;

/** A fixture row as the API sends it (the fixture leaves out who paid). */
const apiRow = (row: Record<string, unknown>): SharedRow => projectedExpenseSchema.parse({ payer: { email: "sam@example.test" }, paidByYou: false, ...row });

describe("API schemas, contract 2.5.0", () => {
  it("accept a household in any currency, foreign fields and home amounts", () => {
    for (const row of fixture.projection.rows) expect(projectedExpenseSchema.safeParse(apiRow(row)).success).toBe(true);
    expect(projectedExpenseSchema.safeParse({ ...apiRow(fixture.projection.rows[0] ?? {}), householdCurrency: "JPY" }).success).toBe(true);
    expect(memberHomeAmountsSchema.safeParse({ currency: "CAD", totalCents: 1, shareCents: 0, rateStatus: "edited" }).success).toBe(false);
    expect(sharedExpenseSchema.shape.home).toBeDefined();
  });
});

describe("shared rows at your home amounts", () => {
  it("joins the projection as the domain's ledgerWithHouseholds does", () => {
    const view = ledgerWithShared(fixture.projection.ledger, fixture.projection.rows.map(apiRow), []);
    const shared = view.transactions.map((entry) => {
      const { id, total, share, originalAmount, originalCurrency, rate, rateStatus, rateDate } = entry;
      return Object.fromEntries(Object.entries({ id, total, share, originalAmount, originalCurrency, rate, rateStatus, rateDate }).filter(([, value]) => value !== undefined));
    });
    expect(shared).toEqual(fixture.projection.expected);
  });

  it("counts them in Activity's totals and day totals; a row with no rate is left out", () => {
    const rows = fixture.projection.rows.map(apiRow);
    const totals = periodTotals(fixture.projection.ledger, { type: "month", month: "2026-11" }, rows.filter((row) => row.date.startsWith("2026-11")), "2026-11-30");
    // fado 43.89 + insurance 11.15 + tapas 62.10 + hydro 45.00; "no-rate" and "other-home" can't be counted.
    expect(totals.shared).toBe(4389 + 1115 + 6210 + 4500);
    expect(totals.sharedCount).toBe(4);
    const fado = rows.find((row) => row.id === "fado");
    if (!fado) throw new Error("fixture");
    expect(dayTotal([{ key: "shared:fado", source: "shared", date: fado.date, entry: fado }], "CAD", "2026-11-30")).toEqual({ cents: -4389, currency: "CAD" });
    expect(homeAmountsOf(fado, undefined)).toBeNull();
  });
});

describe("settle in another currency", () => {
  it("converts each figure as the shared settleIn does", () => {
    for (const item of fixture.settleIn) {
      if (!item.expected) continue;
      const balances = item.balances.map((row) => ({ userId: row.userId, balanceCents: convertSigned(row.balanceCents, item.from, item.to, item.rate) }));
      expect(balances, item.name).toEqual(item.expected.balances);
    }
  });
});

describe("trips in several currencies", () => {
  const split = (cents: number, ids: string[]) => ids.map((userId) => ({ userId, amountCents: cents }));
  const expense = (id: string, date: string, totalCents: number, splits: { userId: string; amountCents: number }[], extra: Partial<SharedExpense> = {}): SharedExpense =>
    sharedExpenseSchema.parse({
      id, householdId: "lisbon", title: id, date, totalCents, payerUserId: "sam", splitMode: "equal", category: { name: "Travel", icon: "airplane", color: "#5B7DB1" }, note: "",
      splits, revision: 1, createdBy: "sam", createdAt: 0, updatedBy: "sam", updatedAt: 0, payments: [], paymentsClosed: false, ...extra,
    });
  const all = ["you", "sam", "jo", "mira"];
  const lisbon = [
    expense("fado", "2026-11-09", 12000, split(3000, all), { home: { currency: "CAD", totalCents: 17556, shareCents: 4389, rate: "1.463", rateStatus: "provisional", rateDate: "2026-11-06" } }),
    expense("insurance", "2026-11-03", 1526, split(763, ["you", "mira"]), { originalAmount: 2230, originalCurrency: "CAD", rate: "0.6843", rateStatus: "published", rateDate: "2026-11-03", home: { currency: "CAD", totalCents: 2230, shareCents: 1115 } }),
    expense("apartment", "2026-10-08", 25600, split(6400, all), { home: { currency: "CAD", totalCents: 37325, shareCents: 9331, rate: "1.458", rateStatus: "published", rateDate: "2026-10-08" } }),
    expense("flights", "2026-10-02", 56400, split(14100, all), { originalAmount: 60000, originalCurrency: "USD", rate: "0.94", rateStatus: "published", rateDate: "2026-10-02", home: { currency: "CAD", totalCents: 82380, shareCents: 20595, rate: "1.373", rateStatus: "published", rateDate: "2026-10-02" } }),
  ];

  it("totals the trip and your share in your currency, as the cards' $1,394.91 and $354.30", () => {
    const totals = homeTripTotals(lisbon, "you", [], { startDate: "2026-11-12", endDate: "2026-11-19" }, "EUR", "CAD");
    expect(totals).toMatchObject({ tripTotal: 139491, yourSpending: 35430, missing: 0, outside: 4 });
    // Without home amounts (no rate known), an expense is left out and counted as missing.
    const unknown = lisbon.map((item) => ({ ...item, home: undefined }));
    expect(homeTripTotals(unknown, "you", [], { startDate: "2026-11-12", endDate: "2026-11-19" }, "EUR", "CAD")).toMatchObject({ tripTotal: 0, missing: 4 });
  });

  it("lists the currencies paid in: the trip's first, then by first use", () => {
    expect(currenciesPaidIn(lisbon, "EUR")).toEqual(["EUR", "USD", "CAD"]);
    expect(listCodes(["EUR", "USD", "CAD"])).toBe("EUR, USD and CAD");
    expect(listCodes(["EUR"])).toBe("EUR");
    expect(paidOf(lisbon[3] ?? lisbon[0] ?? ({} as SharedExpense), "EUR")).toEqual({ amount: 60000, currency: "USD" });
    expect(currencyPlural("EUR")).toBe("euros");
    expect(currencyPlural("THB")).toBe("THB");
  });
});

describe("money in any currency's minor units", () => {
  it("formats yen without decimals and dinars with three", () => {
    expect(formatCents(1200, "JPY")).toBe("JP¥1,200");
    expect(formatCents(1250, "KWD")).toMatch(/1\.250/);
    expect(formatCents(12420, "CAD")).toBe("$124.20");
  });

  it("suggests the trip's currency above the home one in the currency menu", () => {
    const [suggested] = menuSections("", "CAD", ["EUR", "USD"], { code: "EUR", note: "Lisbon's currency" });
    expect(suggested?.items.map((item) => [item.info.code, item.note])).toEqual([
      ["EUR", "Lisbon's currency"],
      ["CAD", "Home"],
    ]);
    // The trip's currency isn't repeated under Recent.
    expect(menuSections("", "CAD", ["EUR", "USD"], { code: "EUR", note: "Lisbon's currency" })[1]?.items.map((item) => item.info.code)).toEqual(["USD"]);
  });
});
