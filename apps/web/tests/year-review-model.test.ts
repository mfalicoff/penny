// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ledgerWithHouseholds, type Household, type ProjectedExpense } from "../src/domain/householdProjection.ts";
import type { Ledger } from "../src/domain/ledger.ts";
import { yearReview, type YearReview } from "../src/domain/yearReview.ts";
import { countedIn, facts, latestReviewYear, monthColumns, payerLabel, reviewYear, tripLine, tripName, tripsTitle, yearBannerYear } from "../src/features/year-review/model";
import { shareCard, shareCardText, shareName } from "../src/features/year-review/shareCard";

// MAZ-292 phase 2: the year in review's wording and the share image's content, from the shared
// rule's golden fixture (contracts/fixtures/year-review.json).
interface Golden {
  households: (Pick<Household, "id" | "name" | "memberCount"> & { trip?: { startDate: string; endDate: string } })[];
  ledgers: Record<string, Ledger>;
  projections: Record<string, ProjectedExpense[]>;
}
const golden = JSON.parse(readFileSync(new URL("../../../contracts/fixtures/year-review.json", import.meta.url), "utf8")) as Golden;
const households = golden.households;

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing from the fixture");
  return value;
}

/** The fixture with every entry title, note, receipt, trip name and household name made unmistakable. */
function secretive(): { view: Ledger; households: Golden["households"] } {
  const ledger = must(golden.ledgers.alex);
  const marked: Ledger = {
    ...ledger,
    trips: ledger.trips.map((trip) => ({ ...trip, name: `SECRET-TRIP-${trip.id}` })),
    transactions: ledger.transactions.map((entry) => ({ ...entry, title: `SECRET-TITLE-${entry.id}`, note: "SECRET-NOTE about a doctor", receiptId: "SECRET-RECEIPT" })),
  };
  const projection = must(golden.projections.households).map((row) => ({ ...row, title: `SECRET-TITLE-${row.id}`, note: "SECRET-NOTE", householdName: `SECRET-HOUSEHOLD-${row.householdId}`, receiptId: "SECRET-RECEIPT" }));
  return { view: ledgerWithHouseholds(marked, projection), households: households.map((household) => ({ ...household, name: `SECRET-HOUSEHOLD-${household.id}` })) };
}

function review(today = "2027-01-05"): YearReview {
  return yearReview(ledgerWithHouseholds(must(golden.ledgers.alex), must(golden.projections.households)), "2026", { today, households });
}

describe("year in review: which year", () => {
  it("opens the year offered from December 26 to January 31, else last year, and never a later one", () => {
    expect(latestReviewYear("2026-12-28")).toBe("2026");
    expect(latestReviewYear("2027-01-31")).toBe("2026");
    expect(latestReviewYear("2026-11-27")).toBe("2025");
    expect(reviewYear(undefined, "2026-12-28")).toBe("2026");
    expect(reviewYear(2024, "2026-12-28")).toBe("2024");
    expect(reviewYear(2027, "2026-12-28")).toBe("2026");
  });

  it("offers January's banner until it's dismissed for that year", () => {
    expect(yearBannerYear("2027-01-03", null)).toBe("2026");
    expect(yearBannerYear("2027-01-03", "2026")).toBeNull();
    expect(yearBannerYear("2027-01-03", "2025")).toBe("2026");
    expect(yearBannerYear("2026-12-28", null)).toBeNull();
  });
});

describe("year in review: the page's words", () => {
  const year = review();

  it("names trips, who paid and where, as web-year-review does", () => {
    expect(tripsTitle(year)).toMatch(/^\d+ trips?, \d+ days? away$/);
    const shared = must(year.trips.list.find((trip) => trip.kind === "shared"));
    expect(tripName(shared, must(golden.ledgers.alex), households)).toBe(households.find((household) => household.id === shared.id)?.name);
    expect(tripLine(shared)).toMatch(/· shared with \d+$/);
    const personal = must(year.trips.list.find((trip) => trip.kind === "personal"));
    expect(tripLine(personal)).toMatch(/· only you$/);
    expect(year.shared.payers.map(payerLabel)).toEqual(["You", "Jo", "Former member", "Mira"]);
    expect(countedIn(year, households)).toBe("Counted by who paid, in Apartment, Lisbon and Porto.");
  });

  it("says a deleted payer is a Former member, never their email", () => {
    const gone = must(year.shared.payers.find((payer) => payer.payer?.deleted));
    expect(payerLabel(gone)).toBe("Former member");
    expect(shareName(gone.payer)).toBe("Former member");
  });

  it("draws 12 columns with the busiest at full height, and fun facts from counts and dates only", () => {
    const columns = monthColumns(year);
    expect(columns).toHaveLength(12);
    expect(columns.filter((column) => column.busiest)).toHaveLength(1);
    expect(Math.max(...columns.map((column) => column.height))).toBe(100);
    const list = facts(year);
    expect(list.map((fact) => fact.key)).toEqual(["quiet", "run", "recorded", "weekday"]);
    expect(list[2]?.label).toMatch(/^expenses recorded, about \d+ a week$/);
  });
});

describe("share image content", () => {
  const { view, households: secretHouseholds } = secretive();
  const year = yearReview(view, "2026", { today: "2027-01-05", households: secretHouseholds });
  const hidden = shareCard(year, "CAD", false);
  const shown = shareCard(year, "CAD", true);

  it("hidden (the default) has no amounts and no payer names: only percentages, rankings and counts", () => {
    const text = shareCardText(hidden).join("\n");
    expect(text).not.toMatch(/\$/);
    expect(hidden.categories.every((category) => category.amount === null)).toBe(true);
    expect(hidden.subtitle).toEqual({ strong: null, text: "Where my money went" });
    for (const payer of year.shared.payers) {
      if (payer.payer) {
        expect(text).not.toContain(payer.payer.email);
        if (payer.payer.displayName) expect(text).not.toContain(payer.payer.displayName);
      }
    }
    expect(text).not.toContain("Former member");
    expect(text).toContain(`I paid for ${String(year.shared.paidByYouPercent)}%`);
  });

  it("shown has the total, the category amounts, the busiest month's amount and who paid by name", () => {
    const text = shareCardText(shown).join("\n");
    expect(shown.subtitle.strong).toMatch(/^\$[\d,]+$/);
    expect(shown.categories.every((category) => category.amount?.startsWith("$"))).toBe(true);
    expect(text).toMatch(/busiest month · \$[\d,]+/);
    expect(text).toContain("I paid 4 · Jo paid 2");
    expect(text).toContain("of our shared expenses · Former member 1");
  });

  it("never carries an entry title, note, receipt, trip name, household name or email, in either version", () => {
    for (const card of [hidden, shown]) {
      const all = JSON.stringify(card);
      expect(all).not.toMatch(/SECRET/);
      expect(all).not.toMatch(/@/);
    }
  });

  it("leaves out a line whose data is empty: no trips, no shared expenses", () => {
    const quiet = yearReview(must(golden.ledgers.alex), "2026", { today: "2027-01-05", households: [] });
    const alone: YearReview = { ...quiet, trips: { ...quiet.trips, list: [], daysAway: 0 } };
    const card = shareCard(alone, "CAD", true);
    expect(card.tiles.map((tile) => tile.key)).toEqual(["month", "quiet"]);
    // The busiest month, alone in its row, spans both columns.
    expect(card.tiles[0]?.wide).toBe(true);
    const empty = yearReview(must(golden.ledgers.empty), "2026", { today: "2027-01-05", households: [] });
    expect(shareCard(empty, "CAD", false).tiles).toEqual([]);
  });

  it("matches the snapshot of both versions", () => {
    const plain = yearReview(ledgerWithHouseholds(must(golden.ledgers.alex), must(golden.projections.households)), "2026", { today: "2027-01-05", households });
    expect({ hidden: shareCard(plain, "CAD", false), shown: shareCard(plain, "CAD", true) }).toMatchSnapshot();
  });
});
