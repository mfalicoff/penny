import type { Ledger, Transaction } from "@domain/ledger.ts";
import { describe, expect, it } from "vitest";
import type { PurchaseInboxItem, ReceiptInboxItem } from "../src/api/schemas";
import { accountForCard, addAllPlan, apartText, capturedText, homeAmount, purchaseCountLabel, purchaseMatches, shortWhen, suggestCategory, whenText } from "../src/features/purchaseInbox/model";

/** Captured purchases (MAZ-291): the category and account rules, matching, Add all and the words. Synthetic data only. */

const at = (day: string, hour = 12, minute = 0) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), hour, minute).getTime();

const tx = (id: string, title: string, extra: Partial<Transaction> = {}): Transaction => ({ id, title, kind: "expense", total: 675, share: 675, categoryId: "food", date: "2026-11-12", note: "", ...extra });

const ledger = (transactions: Transaction[] = []): Ledger => ({
  version: 4,
  currency: "CAD",
  accounts: [
    { id: "visa", name: "Visa", type: "credit" },
    { id: "chq", name: "Chequing", type: "bank" },
  ],
  trips: [],
  categories: [
    { id: "groceries", name: "Groceries", icon: "basket-outline", color: "#6C9C79", kind: "expense" },
    { id: "food", name: "Food & drinks", icon: "cafe-outline", color: "#E47850", kind: "expense" },
    { id: "fun", name: "Fun", icon: "musical-notes-outline", color: "#B15B7D", kind: "expense" },
    { id: "salary", name: "Salary", icon: "briefcase-outline", color: "#6C9C79", kind: "income" },
  ],
  transactions,
  recurring: [],
});

const purchase = (extra: Partial<PurchaseInboxItem> = {}): PurchaseInboxItem => ({
  id: "p1",
  merchant: "Mill St. Coffee",
  amount: 675,
  currency: "CAD",
  card: "Visa 0001",
  capturedAt: at("2026-11-12", 8, 5),
  createdAt: at("2026-11-12", 8, 5),
  status: "to_review",
  outcome: null,
  entryId: null,
  householdId: null,
  resolvedAt: null,
  ...extra,
});

const receipt = (from: string, receivedAt: number, extra: Partial<ReceiptInboxItem> = {}): ReceiptInboxItem => ({
  id: "r1",
  from,
  subject: "Your receipt",
  receivedAt,
  status: "to_attach",
  senderVerified: true,
  expiresAt: null,
  attachedAt: null,
  files: [],
  ...extra,
});

describe("suggestCategory", () => {
  it("takes the category of the last expense with the same title, trimmed and ignoring case", () => {
    const book = ledger([tx("a", "steam", { categoryId: "food", date: "2026-10-01" }), tx("b", " Steam ", { categoryId: "fun", date: "2026-11-01" }), tx("c", "Pay", { kind: "income", categoryId: "salary" })]);
    expect(suggestCategory(book, "STEAM")).toEqual({ category: expect.objectContaining({ id: "fun" }) as unknown, source: "last" });
  });

  it("falls back to the most used expense category, then the first one", () => {
    expect(suggestCategory(ledger([tx("a", "Metro", { categoryId: "groceries" }), tx("b", "Bakery", { categoryId: "food" }), tx("c", "Cafe", { categoryId: "food" })]), "New place")).toEqual({
      category: expect.objectContaining({ id: "food" }) as unknown,
      source: "usual",
    });
    expect(suggestCategory(ledger(), "New place")?.category.id).toBe("groceries");
    expect(suggestCategory({ ...ledger(), categories: [] }, "New place")).toBeNull();
  });

  it("never suggests an income category even when the title matches", () => {
    expect(suggestCategory(ledger([tx("a", "Refund", { kind: "income", categoryId: "salary" })]), "Refund")?.source).toBe("usual");
  });
});

describe("accountForCard", () => {
  it("finds the mapped account by card name without case, only while the account exists", () => {
    const cards = [
      { card: "Visa 0001", accountId: "visa" },
      { card: "Amex 0002", accountId: "gone" },
    ];
    expect(accountForCard(cards, "visa 0001", ledger())).toBe("visa");
    expect(accountForCard(cards, "Amex 0002", ledger())).toBeNull();
    expect(accountForCard(cards, "Mastercard", ledger())).toBeNull();
    expect(accountForCard(cards, null, ledger())).toBeNull();
  });
});

describe("homeAmount", () => {
  it("converts another currency at the day's rate, and waits without one", () => {
    const rates = { enabled: true, source: "European Central Bank", base: "CAD", date: "2026-11-08", rateDate: "2026-11-06", provisional: false, latestDate: "2026-11-06", rates: { USD: "1.3742" } };
    expect(homeAmount(purchase({ amount: 3499, currency: "USD" }), "CAD", rates)).toBe(4808);
    expect(homeAmount(purchase({ amount: 3499, currency: "USD" }), "CAD", undefined)).toBeNull();
    expect(homeAmount(purchase(), "CAD", undefined)).toBe(675);
  });
});

describe("purchaseMatches", () => {
  it("offers an emailed receipt from the merchant received close by, then an entry for the same amount within a day", () => {
    const book = ledger([tx("coffee", "Coffee", { accountId: "visa" }), tx("other", "Coffee", { total: 700, share: 700 }), tx("old", "Coffee", { date: "2026-11-09" })]);
    const receipts = [receipt(`"Mill St. Coffee" <r@mill.example>`, at("2026-11-12", 8, 6)), receipt(`"Acme" <a@acme.example>`, at("2026-11-12", 8, 6), { id: "r2" }), receipt(`"Mill St. Coffee" <r@mill.example>`, at("2026-11-20"), { id: "r3" })];
    const matches = purchaseMatches(purchase(), { ledger: book, receipts, account: "visa" });
    expect(matches.map((match) => match.key)).toEqual(["receipt:r1", "entry:coffee"]);
    expect(matches[0]).toMatchObject({ kind: "receipt", apartMs: 60_000 });
    expect(matches[1]).toMatchObject({ kind: "entry", sameCard: true });
  });

  it("matches a foreign purchase only to an entry paid in that currency and amount", () => {
    const book = ledger([tx("steam", "Steam", { total: 4808, share: 4808, originalAmount: 3499, originalCurrency: "USD", rate: "1.3742", rateStatus: "published", rateDate: "2026-11-11" }), tx("cad", "Other", { total: 3499, share: 3499 })]);
    expect(purchaseMatches(purchase({ amount: 3499, currency: "USD", merchant: "Steam" }), { ledger: book, receipts: [], account: null }).map((match) => match.key)).toEqual(["entry:steam"]);
  });

  it("skips attached receipts, income and entries other purchases already claimed", () => {
    const book = ledger([tx("coffee", "Coffee"), tx("pay", "Pay", { kind: "income", categoryId: "salary" })]);
    const receipts = [receipt(`"Mill St. Coffee" <r@mill.example>`, at("2026-11-12", 8, 6), { status: "attached" })];
    expect(purchaseMatches(purchase(), { ledger: book, receipts, account: null, claimed: new Set(["coffee"]) })).toEqual([]);
  });
});

describe("Add all", () => {
  it("adds what matches nothing and keeps the rest for review", () => {
    expect(addAllPlan([1, 2, 3, 4], (n) => n % 2 === 0)).toEqual({ add: [1, 3], stay: [2, 4] });
  });
});

describe("words", () => {
  const now = at("2026-11-12", 18);
  it("says when, as the cards write it", () => {
    expect(whenText(at("2026-11-12", 8, 5), now)).toBe("Today, 8:05 AM");
    expect(whenText(at("2026-11-11", 18, 40), now)).toBe("Yesterday, 6:40 PM");
    expect(whenText(at("2026-11-08", 21, 14), now)).toBe("Sun, Nov 8");
    expect(whenText(at("2025-11-08", 21, 14), now)).toBe("Sat, Nov 8, 2025");
    expect(capturedText(at("2026-11-08", 21, 14), now)).toBe("Sun, Nov 8, 9:14 PM");
    expect(shortWhen(at("2026-11-11", 18, 40), now)).toBe("Yesterday");
  });

  it("says how far apart, and how many wait", () => {
    expect([apartText(30_000), apartText(60_000), apartText(12 * 60_000), apartText(3 * 3_600_000), apartText(26 * 3_600_000)]).toEqual(["a minute apart", "a minute apart", "12 minutes apart", "3 hours apart", "a day apart"]);
    expect([purchaseCountLabel(0), purchaseCountLabel(1), purchaseCountLabel(3), purchaseCountLabel(50, true)]).toEqual(["No purchases to review", "1 purchase to review", "3 purchases to review", "More than 50 purchases to review"]);
  });
});
