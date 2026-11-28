import { convertAmount } from "@domain/currency.ts";
import { dateKey, type Category, type Ledger, type Transaction } from "@domain/ledger.ts";
import type { CardAccount, ExchangeRates, PurchaseInboxItem, ReceiptInboxItem } from "../../api/schemas";
import { frequentCategories } from "../entries/model";
import { senderName } from "../receiptInbox/model";

/**
 * Captured purchases in the Inbox (MAZ-291, cards `web-inbox-captured`, `web-capture-*`): the pure
 * rules behind the list, the purchase sheet, the match suggestions and Add all. Merchant and card
 * names are untrusted text: nothing here turns them into markup.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** An emailed receipt matches a purchase received this close to it (either side). */
export const RECEIPT_MATCH_MS = 2 * DAY_MS;
/** An entry matches a purchase dated this many days either side of it. */
export const ENTRY_MATCH_DAYS = 1;

/** The calendar day of the purchase, in this browser's time zone. */
export const purchaseDay = (item: Pick<PurchaseInboxItem, "capturedAt">) => dateKey(new Date(item.capturedAt));

const normalized = (value: string) => value.trim().toLocaleLowerCase("en-CA");

/* ---------- category and account ---------- */

export interface CategorySuggestion {
  category: Category;
  /** `last`: the last expense with the same title. `usual`: the most used expense category. */
  source: "last" | "usual";
}

/**
 * The category Add starts on: the last expense whose title is the merchant (trimmed, ignoring
 * case), else the expense category used most, else the first expense category.
 */
export function suggestCategory(ledger: Pick<Ledger, "categories" | "transactions">, merchant: string): CategorySuggestion | null {
  const name = normalized(merchant);
  const expenseCategories = new Map(ledger.categories.filter((category) => category.kind === "expense").map((category) => [category.id, category]));
  let last: Transaction | undefined;
  for (const entry of ledger.transactions) {
    if (entry.kind !== "expense" || normalized(entry.title) !== name || !expenseCategories.has(entry.categoryId)) continue;
    if (!last || entry.date >= last.date) last = entry;
  }
  const from = last ? expenseCategories.get(last.categoryId) : undefined;
  if (from) return { category: from, source: "last" };
  const usual = frequentCategories(ledger, "expense")[0];
  return usual ? { category: usual, source: "usual" } : null;
}

/** The personal account the card is mapped to, while that account exists. */
export function accountForCard(cards: readonly CardAccount[], card: string | null, ledger: Pick<Ledger, "accounts">): string | null {
  if (!card) return null;
  const name = normalized(card);
  const mapped = cards.find((item) => normalized(item.card) === name);
  return mapped && ledger.accounts.some((account) => account.id === mapped.accountId) ? mapped.accountId : null;
}

/* ---------- conversion ---------- */

/** The purchase in home minor units at `rates` (asked in the home currency for its day), or null without a rate. */
export function homeAmount(item: Pick<PurchaseInboxItem, "amount" | "currency">, home: string, rates: ExchangeRates | undefined | null): number | null {
  if (item.currency === home) return item.amount;
  const rate = rates?.enabled ? rates.rates[item.currency] : undefined;
  return rate ? convertAmount(item.amount, item.currency, rate, home) : null;
}

/* ---------- matches ---------- */

export type PurchaseMatch =
  | { kind: "receipt"; key: string; receipt: ReceiptInboxItem; apartMs: number }
  | { kind: "entry"; key: string; entry: Transaction; sameCard: boolean };

/** Entries dated within a day of the purchase for the same amount, in its currency or in home cents. */
function entryMatches(item: PurchaseInboxItem, ledger: Pick<Ledger, "transactions" | "currency">, account: string | null, claimed: ReadonlySet<string>): PurchaseMatch[] {
  const day = purchaseDay(item);
  const home = ledger.currency;
  return ledger.transactions
    .filter((entry) => {
      if (entry.kind !== "expense" || claimed.has(entry.id) || daysBetween(entry.date, day) > ENTRY_MATCH_DAYS) return false;
      return entry.originalCurrency ? entry.originalCurrency === item.currency && entry.originalAmount === item.amount : item.currency === home && entry.total === item.amount;
    })
    .sort((a, b) => daysBetween(a.date, day) - daysBetween(b.date, day) || a.title.localeCompare(b.title))
    .map((entry) => ({ kind: "entry" as const, key: `entry:${entry.id}`, entry, sameCard: Boolean(account && entry.accountId === account) }));
}

/**
 * Emailed receipts waiting to be attached that look like the purchase: received within two days
 * of it, from a sender whose name or subject has the merchant's name in it (receipts carry no amount).
 */
function receiptMatches(item: PurchaseInboxItem, receipts: readonly ReceiptInboxItem[]): PurchaseMatch[] {
  const name = normalized(item.merchant);
  if (name.length < 2) return [];
  return receipts
    .filter((receipt) => receipt.status !== "attached" && Math.abs(receipt.receivedAt - item.capturedAt) <= RECEIPT_MATCH_MS)
    .filter((receipt) => normalized(senderName(receipt.from)).includes(name) || normalized(receipt.subject).includes(name))
    .sort((a, b) => Math.abs(a.receivedAt - item.capturedAt) - Math.abs(b.receivedAt - item.capturedAt))
    .map((receipt) => ({ kind: "receipt" as const, key: `receipt:${receipt.id}`, receipt, apartMs: Math.abs(receipt.receivedAt - item.capturedAt) }));
}

/** What the purchase may be the same as: emailed receipts first, then entries. Nothing is ever attached without a click. */
export function purchaseMatches(
  item: PurchaseInboxItem,
  context: { ledger: Pick<Ledger, "transactions" | "currency"> | null; receipts: readonly ReceiptInboxItem[]; account: string | null; claimed?: ReadonlySet<string> },
): PurchaseMatch[] {
  return [...receiptMatches(item, context.receipts), ...(context.ledger ? entryMatches(item, context.ledger, context.account, context.claimed ?? new Set()) : [])];
}

/** "a minute apart", "12 minutes apart", "3 hours apart", "a day apart". */
export function apartText(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MINUTE_MS));
  if (minutes < 60) return minutes === 1 ? "a minute apart" : `${String(minutes)} minutes apart`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour apart" : `${String(hours)} hours apart`;
  const days = Math.round(hours / 24);
  return days === 1 ? "a day apart" : `${String(days)} days apart`;
}

/* ---------- Add all ---------- */

/** Add all adds every purchase that matches nothing; a purchase with a match stays for review. */
export function addAllPlan<T>(items: readonly T[], matched: (item: T) => boolean): { add: T[]; stay: T[] } {
  const add: T[] = [];
  const stay: T[] = [];
  for (const item of items) (matched(item) ? stay : add).push(item);
  return { add, stay };
}

/* ---------- words ---------- */

const time = (at: number) => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** The list's when: "Today, 8:05 AM", "Yesterday, 6:40 PM", then "Sun, Nov 8" (with the year from another year). */
export function whenText(at: number, now = Date.now()): string {
  const day = dateKey(new Date(at));
  const today = dateKey(new Date(now));
  const yesterday = dateKey(new Date(new Date(now).setDate(new Date(now).getDate() - 1)));
  if (day === today) return `Today, ${time(at)}`;
  if (day === yesterday) return `Yesterday, ${time(at)}`;
  return dayLabel(at, now);
}

/** "Yesterday" or "Sun, Nov 8", for the shorter lines of Add all. */
export function shortWhen(at: number, now = Date.now()): string {
  const text = whenText(at, now);
  return text.startsWith("Today") ? "Today" : text.startsWith("Yesterday") ? "Yesterday" : text;
}

function dayLabel(at: number, now: number): string {
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** The sheet's line: "Today, 8:05 AM" or "Sun, Nov 8, 9:14 PM". */
export function capturedText(at: number, now = Date.now()): string {
  const text = whenText(at, now);
  return text.includes(":") ? text : `${text}, ${time(at)}`;
}

/** "3 purchases to review". */
export const purchaseCountLabel = (count: number, more = false) =>
  count === 0 ? "No purchases to review" : `${more ? `More than ${String(count)}` : String(count)} ${count === 1 && !more ? "purchase" : "purchases"} to review`;

/** "Add 2 expenses". */
export const addCountLabel = (count: number) => `Add ${String(count)} ${count === 1 ? "expense" : "expenses"}`;

function daysBetween(a: string, b: string): number {
  const utc = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  return Math.round(Math.abs(utc(a) - utc(b)) / DAY_MS);
}
