/**
 * Synthetic personal ledgers for the ledger sync baseline (docs/reference/ledger-sync-baseline.md).
 * Deterministic for a seed, so every run measures the same document. Every value is made up:
 * no real names, merchants or amounts.
 */
import type { Category, Kind, Ledger, PaymentAccount, Recurring, Transaction, Trip } from "../../src/domain/ledger.ts";

/** A small deterministic generator (mulberry32), so the same seed gives the same ledger. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIES: Array<[string, string, Kind]> = [
  ["groceries", "Groceries", "expense"],
  ["food", "Food & drinks", "expense"],
  ["home", "Home", "expense"],
  ["transport", "Transport", "expense"],
  ["health", "Health", "expense"],
  ["fun", "Fun", "expense"],
  ["shopping", "Shopping", "expense"],
  ["bills", "Bills", "expense"],
  ["travel", "Travel", "expense"],
  ["gifts", "Gifts", "expense"],
  ["salary", "Salary", "income"],
  ["side", "Side income", "income"],
  ["savings", "Savings", "investment"],
];

const TITLES = ["Market run", "Corner cafe", "Bus pass", "Pharmacy", "Cinema", "Hardware store", "Phone plan", "Bakery", "Lunch", "Bookshop", "Train ticket", "Pet supplies", "Dinner out", "Hydro bill", "Internet"];
const NOTES = ["", "", "", "Split with a friend", "Weekly shop", "Paid at the counter, receipt kept in the drawer"];

/** Calendar date `days` after 2023-01-01, as `YYYY-MM-DD`. */
function day(days: number): string {
  return new Date(Date.UTC(2023, 0, 1) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Entries are spread over 2023-01-01 .. the day before `today`; rules start after `today`, so nothing materializes. */
export interface SyntheticOptions {
  entries: number;
  seed?: number;
  /** The run's "today" (default 2026-11-25). */
  today?: string;
}

export function syntheticLedger({ entries, seed = 186, today = "2026-11-25" }: SyntheticOptions): Ledger {
  const next = random(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const span = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.UTC(2023, 0, 1)) / 86_400_000);
  const accounts: PaymentAccount[] = [
    { id: "acct-chequing", name: "Chequing", type: "bank" },
    { id: "acct-visa", name: "Visa", type: "credit" },
    { id: "acct-cash", name: "Wallet", type: "cash" },
    { id: "acct-savings", name: "Savings", type: "bank" },
  ];
  const categories: Category[] = CATEGORIES.map(([id, name, kind], index) => ({ id, name, icon: "pricetag-outline", color: `#${(0x3a5f8c + index * 0x0b1d07).toString(16).slice(-6).padStart(6, "0").toUpperCase()}`, kind }));
  const trips: Trip[] = Array.from({ length: 6 }, (_, index) => ({ id: `trip-${index + 1}`, name: `Trip ${index + 1}`, startDate: day(120 + index * 180), endDate: day(127 + index * 180) }));
  const transactions: Transaction[] = [];
  for (let index = 0; index < entries; index += 1) {
    const roll = next();
    const kind: Kind = roll < 0.9 ? "expense" : roll < 0.97 ? "income" : "investment";
    const category = pick(categories.filter((item) => item.kind === kind));
    const total = kind === "expense" ? 100 + Math.floor(next() * 25_000) : 50_000 + Math.floor(next() * 400_000);
    const split = kind === "expense" && next() < 0.15;
    const entry: Transaction = {
      id: `${(1_700_000_000_000 + index * 60_000).toString(36)}-${Math.floor(next() * 36 ** 8).toString(36).padStart(8, "0")}`,
      title: kind === "income" ? "Pay" : kind === "investment" ? "Transfer to savings" : pick(TITLES),
      kind,
      total,
      share: split ? Math.floor(total / 2) : total,
      categoryId: category.id,
      date: day(Math.floor(next() * span)),
      note: pick(NOTES),
    };
    if (next() < 0.85) entry.accountId = pick(accounts).id;
    if (kind === "expense" && next() < 0.03) entry.tripId = pick(trips).id;
    transactions.push(entry);
  }
  const recurring: Recurring[] = [
    { id: "rule-rent", title: "Rent", kind: "expense", total: 180_000, share: 180_000, categoryId: "home", accountId: "acct-chequing", date: "2023-01-01", note: "", frequency: "monthly", nextDate: day(span + 6), anchorDay: 1, active: true },
    { id: "rule-pay", title: "Pay", kind: "income", total: 320_000, share: 320_000, categoryId: "salary", accountId: "acct-chequing", date: "2023-01-13", note: "", frequency: "weekly", nextDate: day(span + 2), anchorDay: 13, active: true },
    { id: "rule-phone", title: "Phone plan", kind: "expense", total: 6_500, share: 6_500, categoryId: "bills", accountId: "acct-visa", date: "2023-01-20", note: "", frequency: "monthly", nextDate: day(span + 25), anchorDay: 20, active: false },
  ];
  return { version: 4, currency: "CAD", accounts, trips, categories, transactions, recurring };
}

/** The same ledger with one entry edited (title and amount), as a save of one changed entry sends it. */
export function editEntry(ledger: Ledger, index: number, round: number): Ledger {
  const transactions = ledger.transactions.map((entry, position) => {
    if (position !== index % ledger.transactions.length) return entry;
    const total = 100 + ((entry.total + 137 * (round + 1)) % 25_000);
    return { ...entry, title: `Edited ${round}`, total, share: entry.share === entry.total ? total : Math.min(entry.share, total) };
  });
  return { ...ledger, transactions };
}

export interface Summary {
  runs: number;
  median: number;
  p90: number;
  min: number;
  max: number;
}

/** Median (lower middle for an even count), nearest-rank p90, min and max. */
export function summarize(samples: readonly number[]): Summary {
  if (samples.length === 0) throw new Error("No samples");
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (rank: number) => sorted[Math.min(sorted.length - 1, Math.max(0, rank))] as number;
  return { runs: sorted.length, median: at(Math.ceil(sorted.length / 2) - 1), p90: at(Math.ceil(sorted.length * 0.9) - 1), min: at(0), max: at(sorted.length - 1) };
}
