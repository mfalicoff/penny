import { dateKey, parseDate, type Kind, type Ledger, type Receipt, type Transaction } from "@domain/ledger.ts";
import { formatBytes, receiptKind } from "../../api/receipts";
import type { ReceiptInboxFile, ReceiptInboxItem, SearchItem } from "../../api/schemas";

/** A shared expense as search returns it. */
export type ProjectedExpense = Extract<SearchItem, { source: "shared" }>["entry"];

/**
 * Emailed receipts (MAZ-184, docs/plans/email-receipts.md "UX guidelines"): the pure rules behind
 * the inbox and the attach sheet. Sender, subject and file names are untrusted text: nothing here
 * turns them into markup, and the screens render them as React text only.
 */

const DAY_MS = 86_400_000;

/** How far either side of the received day an expense can be suggested, and how many. */
export const SUGGEST_DAYS = 7;
export const SUGGEST_MAX = 5;
/** Unattached items say when they'll be deleted during their last days. */
export const EXPIRY_WARN_DAYS = 3;
/** The attached confirmation stays this long on the web (UX guidelines, Done). */
export const ATTACHED_TOAST_MS = 8000;
/** The inbox and From inbox need a connection, like uploads. */
export const OFFLINE_HINT = "Connect to the internet to attach receipts.";

/**
 * The sender's display name: `Acme Store` from `"Acme Store" <billing@acme.example>`, or the bare
 * address when there is no name. Never empty.
 */
export function senderName(from: string): string {
  const trimmed = from.trim();
  const named = /^\s*"?([^"<]*?)"?\s*<([^>]*)>\s*$/.exec(trimmed);
  if (named) {
    const name = (named[1] ?? "").trim();
    const address = (named[2] ?? "").trim();
    return name || address || "Unknown sender";
  }
  return trimmed || "Unknown sender";
}

/** The rendered email first (labelled Email), then each attachment in the order it arrived. */
export function orderedFiles(item: Pick<ReceiptInboxItem, "files">): ReceiptInboxFile[] {
  return [...item.files.filter((file) => file.kind === "email"), ...item.files.filter((file) => file.kind !== "email")];
}

/**
 * The file the attach sheet starts on: the first attachment not yet linked (a merchant's PDF
 * invoice is usually the real receipt), else the rendered email, else whatever is left.
 */
export function preselectFile(item: Pick<ReceiptInboxItem, "files">): ReceiptInboxFile | undefined {
  const open = item.files.filter((file) => !file.linked);
  return open.find((file) => file.kind === "attachment") ?? open.find((file) => file.kind === "email") ?? orderedFiles(item)[0];
}

/** Files that can still be attached. */
export const openFiles = (item: Pick<ReceiptInboxItem, "files">) => orderedFiles(item).filter((file) => !file.linked);

/** "Email" for the rendered message, else the file's own kind ("PDF", "Photo"). */
export const fileKind = (file: Pick<ReceiptInboxFile, "kind" | "mime">) => (file.kind === "email" ? "Email" : receiptKind(file.mime));

/** What the person sees for a file: its name (the rendered email has a fixed one), kind and size. */
export function fileLabel(file: Pick<ReceiptInboxFile, "kind" | "name">): string {
  return file.kind === "email" ? "Email PDF" : file.name || "Attachment";
}
export const fileDetail = (file: Pick<ReceiptInboxFile, "kind" | "mime" | "sizeBytes">) => `${fileKind(file)} · ${formatBytes(file.sizeBytes)}`;

/** An inbox file as the receipt link entries store (the same shape an upload returns). */
export const asReceipt = (file: Pick<ReceiptInboxFile, "receiptId" | "name" | "mime" | "uri" | "kind">): Receipt => ({
  id: file.receiptId,
  name: file.kind === "email" && !file.name ? "Email PDF" : file.name,
  mime: file.mime,
  uri: file.uri,
});

/** The calendar day the email arrived, in this browser's time zone. */
export const receivedDay = (receivedAt: number) => dateKey(new Date(receivedAt));

/** "12 Nov" this year, "12 Nov 2025" otherwise. */
export function dayText(day: string, today = dateKey()): string {
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return parseDate(day).toLocaleDateString("en-CA", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** "12 November", for spoken labels. */
export const spokenDay = (day: string) => parseDate(day).toLocaleDateString("en-CA", { month: "long", day: "numeric" });

/** "1 of 2 attached" for a partly attached item. */
export function attachedCount(item: Pick<ReceiptInboxItem, "files">): string {
  const linked = item.files.filter((file) => file.linked).length;
  return `${String(linked)} of ${String(item.files.length)} attached`;
}

export const filesCount = (count: number) => (count === 1 ? "1 file" : `${String(count)} files`);

/** "Deleted in 3 days" during an unattached item's last three days, else null. */
export function expiryNote(item: Pick<ReceiptInboxItem, "status" | "expiresAt">, now = Date.now()): string | null {
  if (item.status === "attached" || item.expiresAt === null) return null;
  const left = item.expiresAt - now;
  if (left > EXPIRY_WARN_DAYS * DAY_MS) return null;
  const days = Math.max(1, Math.ceil(left / DAY_MS));
  return days === 1 ? "Deleted in 1 day" : `Deleted in ${String(days)} days`;
}

/** The Discard (and Done) confirmation: how many files go and how many stay on their entries. */
export function discardMessage(item: Pick<ReceiptInboxItem, "files">): { title: string; detail: string } {
  const unlinked = item.files.filter((file) => !file.linked).length;
  const kept = item.files.length - unlinked;
  const files = unlinked === 1 ? "Its 1 file will be deleted." : unlinked === 0 ? "No files will be deleted." : `Its ${String(unlinked)} files will be deleted.`;
  const keeps = kept === 0 ? "" : kept === 1 ? " 1 file attached to an entry is kept." : ` ${String(kept)} files attached to entries are kept.`;
  return { title: "Discard this email?", detail: `${files} This can't be undone.${keeps}` };
}

/** "3 receipts to attach", the inbox count as it is read aloud. */
export const countLabel = (count: number, more = false) =>
  count === 0 ? "No receipts to attach" : `${more ? `More than ${String(count)}` : String(count)} ${count === 1 && !more ? "receipt" : "receipts"} to attach`;

/* ---------- attach targets ---------- */

/** An expense the attach sheet can offer: a personal entry or a shared expense. */
export type AttachCandidate =
  | (CandidateBase & { source: "personal"; entry: Transaction })
  | (CandidateBase & { source: "shared"; householdId: string; householdName: string; expenseId: string });

interface CandidateBase {
  key: string;
  title: string;
  kind: Kind;
  date: string;
  /** The entry's total, in its own currency's cents. */
  totalCents: number;
  currency: string | undefined;
  category: { name: string; icon: string; color: string } | null;
  /** The receipt it links now, if any. */
  receipt: { id: string; name: string } | null;
}

/** Personal entries from this browser's ledger (pending changes included). */
export function personalCandidates(ledger: Pick<Ledger, "transactions" | "categories" | "currency">): AttachCandidate[] {
  const categories = new Map(ledger.categories.map((category) => [category.id, category]));
  return ledger.transactions.map((entry) => {
    const category = categories.get(entry.categoryId);
    return {
      source: "personal" as const,
      key: `personal:${entry.id}`,
      entry,
      title: entry.title,
      kind: entry.kind,
      date: entry.date,
      totalCents: entry.total,
      currency: ledger.currency,
      category: category ? { name: category.name, icon: category.icon, color: category.color } : null,
      receipt: entry.receipt ? { id: entry.receipt.id, name: entry.receipt.name } : null,
    };
  });
}

/**
 * Shared expenses as search returns them. Scheduled occurrences aren't expenses yet, and
 * households the person has left (not in `memberOf`) are never offered.
 */
export function sharedCandidates(rows: readonly ProjectedExpense[], memberOf: ReadonlySet<string>): AttachCandidate[] {
  return rows
    .filter((row) => !row.scheduled && memberOf.has(row.householdId))
    .map((row) => ({
      source: "shared" as const,
      key: `shared:${row.id}`,
      householdId: row.householdId,
      householdName: row.householdName,
      expenseId: row.id,
      title: row.title,
      kind: "expense" as const,
      date: row.date,
      totalCents: row.totalCents,
      currency: row.householdCurrency,
      category: row.category,
      receipt: row.receipt ? { id: row.receipt.id, name: row.receipt.name } : row.receiptId ? { id: row.receiptId, name: "Receipt" } : null,
    }));
}

/** Whole days between two `YYYY-MM-DD` days (calendar days, unaffected by DST). */
export function daysApart(a: string, b: string): number {
  const utc = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  return Math.round(Math.abs(utc(a) - utc(b)) / DAY_MS);
}

/** The first and last day a suggestion can fall on. */
export function suggestionRange(day: string): { from: string; to: string } {
  const at = (offset: number) => {
    const date = parseDate(day);
    date.setDate(date.getDate() + offset);
    return dateKey(date);
  };
  return { from: at(-SUGGEST_DAYS), to: at(SUGGEST_DAYS) };
}

/**
 * Suggested: expenses without a receipt dated up to 7 days either side of the received day,
 * nearest first (a later day first on a tie, then by title), at most 5. Income and investments
 * are never offered. Suggestions only reorder choices; nothing is ever attached without a click.
 */
export function suggestions(candidates: readonly AttachCandidate[], day: string): AttachCandidate[] {
  return candidates
    .filter((candidate) => candidate.kind === "expense" && !candidate.receipt && daysApart(candidate.date, day) <= SUGGEST_DAYS)
    .sort((a, b) => daysApart(a.date, day) - daysApart(b.date, day) || b.date.localeCompare(a.date) || a.title.localeCompare(b.title))
    .slice(0, SUGGEST_MAX);
}

/** Search results the sheet can attach to: expenses only, with or without a receipt. */
export const attachable = (candidates: readonly AttachCandidate[]) => candidates.filter((candidate) => candidate.kind === "expense");

/** Shared expenses among search hits. */
export const sharedHits = (items: readonly SearchItem[]): ProjectedExpense[] => items.flatMap((hit) => (hit.source === "shared" ? [hit.entry] : []));

/**
 * Search hits as attach targets, in the server's order. A personal hit is matched to this
 * browser's copy of the entry (so the save is based on what this browser holds); one it doesn't
 * hold yet is left out.
 */
export function searchCandidates(items: readonly SearchItem[], personal: readonly AttachCandidate[], memberOf: ReadonlySet<string>): AttachCandidate[] {
  const byKey = new Map(personal.map((candidate) => [candidate.key, candidate]));
  const shared = new Map(sharedCandidates(sharedHits(items), memberOf).map((candidate) => [candidate.key, candidate]));
  return attachable(items.flatMap((hit) => byKey.get(hit.key) ?? shared.get(hit.key) ?? []));
}

/** The New expense seed: the received day and the sender's name, amount empty, receipt attached. */
export function newExpenseSeed(item: Pick<ReceiptInboxItem, "from" | "receivedAt">, file: ReceiptInboxFile) {
  return {
    amount: "",
    title: senderName(item.from).slice(0, 100),
    date: receivedDay(item.receivedAt),
    accountId: "",
    note: "",
    receipt: asReceipt(file),
  };
}
