import type { Transaction } from "@domain/ledger.ts";
import { describe, expect, it } from "vitest";
import { receiptEmailSchema, receiptInboxCleanupSchema, receiptInboxPageSchema } from "../src/api/schemas";
import {
  attachedCount,
  countLabel,
  daysApart,
  discardMessage,
  expiryNote,
  fileDetail,
  newExpenseSeed,
  orderedFiles,
  personalCandidates,
  preselectFile,
  searchCandidates,
  senderName,
  sharedCandidates,
  suggestionRange,
  suggestions,
  type ProjectedExpense,
} from "../src/features/receiptInbox/model";
import { normalizeSender } from "../src/features/receiptInbox/ReceiptEmailSettings";
import { withReceipt, sharedUpdate } from "../src/features/receiptInbox/attach";
import { ADDRESS, inboxFile, inboxItem, localNoon } from "./fakes/inboxServer";

const DAY = 86_400_000;

describe("emailed receipt API models", () => {
  it("accept the documented envelopes and refuse unknown states", () => {
    expect(receiptEmailSchema.parse({ enabled: false, domain: null, address: null })).toEqual({ enabled: false, domain: null, address: null });
    expect(receiptEmailSchema.parse({ enabled: true, domain: "receipts.example", address: ADDRESS }).address?.address).toBe(ADDRESS.address);
    const page = { items: [inboxItem(1)], next: null };
    expect(receiptInboxPageSchema.parse(page).items[0]?.files).toHaveLength(2);
    expect(receiptInboxPageSchema.safeParse({ items: [{ ...inboxItem(1), status: "discarded" }], next: null }).success).toBe(false);
    expect(receiptInboxPageSchema.safeParse({ items: [{ ...inboxItem(1), files: [{ ...inboxFile("r", "email", "x"), kind: "html" }] }], next: null }).success).toBe(false);
    expect(receiptInboxCleanupSchema.parse({ deleted: 2, kept: 1 })).toEqual({ deleted: 2, kept: 1 });
  });
});

describe("inbox model", () => {
  it("reads the sender's display name, or the bare address", () => {
    expect(senderName(`"Acme Store" <billing@acme.example>`)).toBe("Acme Store");
    expect(senderName("Mill St. Café <hi@mill.example>")).toBe("Mill St. Café");
    expect(senderName("<only@address.example>")).toBe("only@address.example");
    expect(senderName("plain@address.example")).toBe("plain@address.example");
    expect(senderName("  ")).toBe("Unknown sender");
  });

  it("orders the email first, preselects the first open attachment, and labels each file", () => {
    const item = inboxItem(1, { files: [inboxFile("a1", "attachment", "invoice.pdf"), inboxFile("e1", "email", "Email PDF"), inboxFile("a2", "attachment", "photo.png", { mime: "image/png" })] });
    expect(orderedFiles(item).map((file) => file.receiptId)).toEqual(["e1", "a1", "a2"]);
    expect(preselectFile(item)?.receiptId).toBe("a1");
    expect(preselectFile({ files: [inboxFile("e1", "email", "Email PDF"), inboxFile("a1", "attachment", "i.pdf", { linked: true })] })?.receiptId).toBe("e1");
    expect(fileDetail(inboxFile("e1", "email", "Email PDF"))).toBe("Email · 2 KB");
    expect(fileDetail(inboxFile("a2", "attachment", "p.png", { mime: "image/png", sizeBytes: 1.5 * 1024 * 1024 }))).toBe("Photo · 1.5 MB");
    expect(attachedCount({ files: [inboxFile("e", "email", "x", { linked: true }), inboxFile("a", "attachment", "y")] })).toBe("1 of 2 attached");
  });

  it("warns about deletion only in an unattached item's last three days", () => {
    const now = Date.parse("2026-11-16T12:00:00Z");
    expect(expiryNote({ status: "to_attach", expiresAt: now + 10 * DAY }, now)).toBeNull();
    expect(expiryNote({ status: "to_attach", expiresAt: now + 3 * DAY }, now)).toBe("Deleted in 3 days");
    expect(expiryNote({ status: "partly_attached", expiresAt: now + 1.5 * DAY }, now)).toBe("Deleted in 2 days");
    expect(expiryNote({ status: "to_attach", expiresAt: now + 60_000 }, now)).toBe("Deleted in 1 day");
    expect(expiryNote({ status: "attached", expiresAt: null }, now)).toBeNull();
  });

  it("says how many files Discard deletes and how many it keeps", () => {
    expect(discardMessage(inboxItem(1))).toEqual({ title: "Discard this email?", detail: "Its 2 files will be deleted. This can't be undone." });
    expect(discardMessage({ files: [inboxFile("e", "email", "x", { linked: true }), inboxFile("a", "attachment", "y")] }).detail).toBe(
      "Its 1 file will be deleted. This can't be undone. 1 file attached to an entry is kept.",
    );
  });

  it("reads the count aloud", () => {
    expect(countLabel(3)).toBe("3 receipts to attach");
    expect(countLabel(1)).toBe("1 receipt to attach");
    expect(countLabel(50, true)).toBe("More than 50 receipts to attach");
  });

  it("starts New expense on the received day in this time zone, with the sender's name and no amount", () => {
    const item = inboxItem(1, { receivedAt: new Date(2026, 10, 3, 23, 30).getTime() });
    const seed = newExpenseSeed(item, inboxFile("a1", "attachment", "invoice.pdf"));
    expect(seed).toEqual({ amount: "", title: "Acme Store", date: "2026-11-03", accountId: "", note: "", receipt: { id: "a1", name: "invoice.pdf", mime: "application/pdf", uri: "/api/receipts/a1" } });
  });

  it("counts calendar days across a month end", () => {
    expect(daysApart("2026-10-30", "2026-11-02")).toBe(3);
    expect(suggestionRange("2026-11-03")).toEqual({ from: "2026-10-27", to: "2026-11-10" });
  });
});

describe("Suggested", () => {
  const entry = (id: string, date: string, extra: Partial<Transaction> = {}): Transaction => ({ id, title: id, kind: "expense", total: 1000, share: 1000, categoryId: "c", date, note: "", ...extra });
  const ledger = (transactions: Transaction[]) => ({ currency: "CAD", categories: [{ id: "c", name: "Food", icon: "cafe-outline", color: "#E47850", kind: "expense" as const }], transactions });
  const shared = (id: string, date: string, extra: Partial<ProjectedExpense> = {}): ProjectedExpense => ({
    id,
    householdId: "h1",
    householdName: "Flat 4B",
    householdCurrency: "CAD",
    title: id,
    date,
    totalCents: 2000,
    shareCents: 1000,
    payerUserId: "u1",
    category: { name: "Groceries", icon: "basket-outline", color: "#6C9C79" },
    note: "",
    ...extra,
  });

  it("offers expenses without a receipt within 7 days, nearest first, at most 5, personal and shared", () => {
    const candidates = [
      ...personalCandidates(
        ledger([
          entry("far", "2026-11-20"),
          entry("edge", "2026-11-19"),
          entry("same", "2026-11-12"),
          entry("before2", "2026-11-10"),
          entry("after1", "2026-11-13"),
          entry("withReceipt", "2026-11-12", { receipt: { id: "r", name: "r.pdf", mime: "application/pdf", uri: "/api/receipts/r" } }),
          entry("salary", "2026-11-12", { kind: "income" }),
          entry("fund", "2026-11-12", { kind: "investment" }),
          entry("back5", "2026-11-07"),
        ]),
      ),
      ...sharedCandidates([shared("groceries", "2026-11-11"), shared("scheduled", "2026-11-12", { scheduled: true }), shared("left", "2026-11-12", { householdId: "gone" })], new Set(["h1"])),
    ];
    const picked = suggestions(candidates, "2026-11-12");
    expect(picked.map((candidate) => candidate.title)).toEqual(["same", "after1", "groceries", "before2", "back5"]);
    expect(picked.find((candidate) => candidate.title === "groceries")).toMatchObject({ source: "shared", householdName: "Flat 4B" });
    // The sixth match (edge, 7 days away) is cut by the limit; 8 days away is never offered.
    expect(suggestions(candidates.filter((candidate) => candidate.title !== "same"), "2026-11-12").map((candidate) => candidate.title)).toContain("edge");
    expect(suggestions(candidates, "2026-11-12").map((candidate) => candidate.title)).not.toContain("far");
  });

  it("search offers expenses with or without a receipt, never income", () => {
    const personal = personalCandidates(ledger([entry("lunch", "2026-01-02", { receipt: { id: "r", name: "r.pdf", mime: "application/pdf", uri: "/api/receipts/r" } }), entry("pay", "2026-01-02", { kind: "income" })]));
    const hits = [
      { key: "personal:lunch", source: "personal" as const, match: null, entry: { ...entry("lunch", "2026-01-02") } },
      { key: "personal:pay", source: "personal" as const, match: null, entry: { ...entry("pay", "2026-01-02"), kind: "income" as const } },
      { key: "shared:s1", source: "shared" as const, match: null, entry: shared("s1", "2026-01-03") },
    ];
    expect(searchCandidates(hits, personal, new Set(["h1"])).map((candidate) => candidate.key)).toEqual(["personal:lunch", "shared:s1"]);
  });
});

describe("attach saves", () => {
  it("sets or drops an entry's receipt link", () => {
    const base: Transaction = { id: "e", title: "t", kind: "expense", total: 1, share: 1, categoryId: "c", date: "2026-01-01", note: "" };
    const receipt = { id: "r", name: "r.pdf", mime: "application/pdf", uri: "/api/receipts/r" };
    expect(withReceipt(base, receipt)).toEqual({ ...base, receipt });
    expect(withReceipt({ ...base, receipt }, null)).toEqual(base);
    expect(withReceipt({ ...base, receipt }, null)).not.toHaveProperty("receipt");
  });

  it("sends a shared expense back as read, with only the receipt changed", () => {
    const expense = {
      id: "s1",
      householdId: "h1",
      title: "Groceries",
      totalCents: 2000,
      payerUserId: "u1",
      splitMode: "equal" as const,
      category: { name: "Groceries", icon: "basket-outline", color: "#6C9C79" },
      note: "",
      date: "2026-11-11",
      splits: [],
      revision: 4,
      createdBy: "u1",
      createdAt: 1,
      updatedBy: "u1",
      updatedAt: 1,
      payments: [],
      paymentsClosed: false,
      receiptId: "old",
    };
    expect(sharedUpdate(expense, "new")).toMatchObject({ title: "Groceries", totalCents: 2000, splitMode: "equal", date: "2026-11-11", revision: 4, receiptId: "new" });
    expect(sharedUpdate(expense, null)).not.toHaveProperty("receiptId");
  });

  it("stores allowed senders lowercase, without a leading @", () => {
    expect(normalizeSender("  @Example.COM ")).toBe("example.com");
    expect(localNoon("2026-11-12")).toBe(new Date(2026, 10, 12, 12).getTime());
  });
});
