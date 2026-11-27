import type { ExpensePayer } from "@domain/householdProjection.ts";
import type { YearPayer, YearReview } from "@domain/yearReview.ts";
import { categoryHex } from "../../design/categoryTint";
import { formatWhole } from "../../design/Money";
import { monthName } from "./model";

/**
 * What the year's share image says (MAZ-292 phase 2; cards `web-year-review-share`,
 * `web-year-review-share-amounts`), as plain data the canvas draws.
 *
 * It is built from the `YearReview` result alone: category names, rankings, percentages, counts,
 * months and, with amounts shown, amounts and who paid. The review carries no entry titles, notes,
 * receipts, trip names or household names, and nothing here looks anything else up, so none of
 * them can reach the image. Who paid is named by display name only, never by email: someone with no
 * display name is "A member", a deleted account "Former member".
 *
 * A line whose data is empty (no trips, no shared expenses, no spending) is left out.
 */

export interface ShareCategory {
  rank: number;
  name: string;
  /** The category's light-appearance color, `#RRGGBB`: the image is always light. */
  color: string;
  percent: string;
  /** Only with amounts shown. */
  amount: string | null;
}

export interface ShareTile {
  key: "month" | "trips" | "shared" | "quiet";
  title: string;
  subtitle: string;
  /** Spans both columns. */
  wide: boolean;
}

export interface ShareCard {
  showAmounts: boolean;
  /** "My 2026". */
  title: string;
  /** Hidden: "Where my money went". Shown: the total, drawn bold, then " spent". */
  subtitle: { strong: string | null; text: string };
  categories: ShareCategory[];
  tiles: ShareTile[];
  footer: string;
}

const plural = (count: number, one: string, many: string) => `${String(count)} ${count === 1 ? one : many}`;

/** A payer as the image may name them: the first word of their display name, never their email. */
export function shareName(payer: ExpensePayer | null): string {
  if (!payer) return "A member";
  if (payer.deleted) return "Former member";
  const first = payer.displayName?.trim().split(/\s+/)[0];
  return first || "A member";
}

const paid = (payer: YearPayer) => (payer.you ? `I paid ${String(payer.count)}` : `${shareName(payer.payer)} paid ${String(payer.count)}`);

function sharedTile(review: YearReview, showAmounts: boolean): ShareTile | null {
  const { shared } = review;
  if (shared.count === 0) return null;
  if (!showAmounts || !shared.payers.length) return { key: "shared", title: `I paid for ${String(shared.paidByYouPercent)}%`, subtitle: "of our shared expenses", wide: true };
  // `web-year-review-share-amounts`: "I paid 41 · Jo paid 30", then "of our shared expenses · Mira 12".
  const [first, second, third] = shared.payers;
  const title = [first, second].filter((payer): payer is YearPayer => Boolean(payer)).map(paid).join(" · ");
  const rest = third ? ` · ${third.you ? paid(third) : `${shareName(third.payer)} ${String(third.count)}`}` : "";
  return { key: "shared", title, subtitle: `of our shared expenses${rest}`, wide: true };
}

/** The share image's content for `review`, with amounts and names hidden (the default) or shown. */
export function shareCard(review: YearReview, currency: string | undefined, showAmounts: boolean): ShareCard {
  const money = (cents: number) => formatWhole(cents, currency);
  const categories = review.topCategories.slice(0, 3).map((category, index) => ({
    rank: index + 1,
    name: category.name,
    color: categoryHex({ color: category.color }),
    percent: `${String(category.share)}%`,
    amount: showAmounts ? money(category.amount) : null,
  }));

  const tiles: ShareTile[] = [];
  const busiest = review.busiestMonth;
  if (busiest) tiles.push({ key: "month", title: monthName(busiest.month), subtitle: showAmounts ? `busiest month · ${money(busiest.spent)}` : "busiest month", wide: false });
  const trips = review.trips.list.length;
  if (trips > 0) tiles.push({ key: "trips", title: plural(trips, "trip", "trips"), subtitle: `${plural(review.trips.daysAway, "day", "days")} away`, wide: false });
  // A half tile alone takes the whole row.
  if (tiles.length === 1 && tiles[0]) tiles[0] = { ...tiles[0], wide: true };
  const shared = sharedTile(review, showAmounts);
  if (shared) tiles.push(shared);
  if (review.from) tiles.push({ key: "quiet", title: String(review.facts.daysWithoutSpending), subtitle: review.facts.daysWithoutSpending === 1 ? "day without spending" : "days without spending", wide: true });

  return {
    showAmounts,
    title: `My ${review.year}`,
    subtitle: showAmounts ? { strong: money(review.spent), text: " spent" } : { strong: null, text: "Where my money went" },
    categories,
    tiles,
    footer: "Made with Penny",
  };
}

/** Every piece of text on the image, in reading order: the alternative text, and what the tests check. */
export function shareCardText(card: ShareCard): string[] {
  return [
    "Penny",
    card.title,
    `${card.subtitle.strong ?? ""}${card.subtitle.text}`,
    ...card.categories.map((category) => [String(category.rank), category.name, category.amount, category.percent].filter(Boolean).join(" ")),
    ...card.tiles.map((tile) => `${tile.title} ${tile.subtitle}`),
    card.footer,
  ];
}
