import { saveEntry, type LedgerChange } from "@domain/commands.ts";
import {
  cents,
  kindLabels,
  nextOccurrence,
  parseDate,
  personalShare,
  recordedSplit,
  splitParticipants,
  uid,
  validDate,
  type Category,
  type Frequency,
  type Kind,
  type Ledger,
  type Receipt,
  type Recurring,
  type Transaction,
} from "@domain/ledger.ts";
import { ICON_SVG } from "@design-kit/src/icons";
import type { IconName } from "../../design/Icon";
import { MAX_SCHEDULES } from "../recurring/model";

/**
 * The personal entry form's draft and its validation (MAZ-88), on top of the shared domain
 * (`@domain/ledger.ts`, `@domain/commands.ts`): integer cents, the personal share modes, a repeat
 * that creates a rule whose first occurrence is this entry, and trips and receipts on expenses
 * only. Saving goes through the durable offline store as a `LedgerChange`, never straight to the API.
 */

export type ShareMode = "full" | "equal" | "amount" | "percent";
export type Repeat = "none" | Frequency;

export interface EntryDraft {
  /** Fixed for the life of the draft, so a repeated submit writes the same entry instead of a second one. */
  id: string;
  /** Fixed too: the rule a repeating new entry creates. */
  ruleId: string;
  kind: Kind;
  title: string;
  amount: string;
  date: string;
  categoryId: string;
  accountId: string;
  tripId: string;
  note: string;
  split: ShareMode;
  shareInput: string;
  repeat: Repeat;
  /** The linked receipt (expenses only): uploaded in this form, or the entry's own. Null for none. */
  receipt: Receipt | null;
}

export type DraftField = "amount" | "title" | "date" | "category" | "account" | "trip" | "share" | "note";
export type DraftErrors = Partial<Record<DraftField, string>>;

/** Fields in the order the form shows them, for moving focus to the first problem. */
export const FIELD_ORDER: DraftField[] = ["amount", "title", "category", "date", "account", "share", "trip", "note"];

export const KIND_PLURAL: Record<Kind, string> = { expense: "Expenses", income: "Income", investment: "Investments" };
export { kindLabels };

const pad = (value: number) => String(value).padStart(2, "0");
export function today(now = new Date()): string {
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const centsToInput = (value: number) => (value / 100).toFixed(2);

/**
 * The note under an income date after today (`add-income` card, MAZ-136): that pay is expected and
 * counts toward Projected, not Left to spend, until its date. `null` for any other draft; future
 * expenses and investments are recorded (MAZ-139).
 */
export function futureIncomeNote(draft: Pick<EntryDraft, "kind" | "date">, now = today()): string | null {
  if (draft.kind !== "income" || !validDate(draft.date) || draft.date <= now) return null;
  const day = parseDate(draft.date).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  return `${day} is still ahead, so this pay shows as expected. It counts toward Projected until the day it's recorded — not toward Left to spend.`;
}

/**
 * Categories of `kind`, most used first (ties keep the ledger's order). Forms and Activity show the
 * first few inline and the rest behind "All categories".
 */
export function frequentCategories(ledger: Pick<Ledger, "categories" | "transactions">, kind?: Kind): Category[] {
  const uses = new Map<string, number>();
  for (const entry of ledger.transactions) uses.set(entry.categoryId, (uses.get(entry.categoryId) ?? 0) + 1);
  const order = new Map(ledger.categories.map((category, index) => [category.id, index]));
  return ledger.categories
    .filter((category) => !kind || category.kind === kind)
    .sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/**
 * The category picker's Most used (`iphone-category-picker`): up to `limit` categories of `kind`
 * that entries use, most used first. Empty for a ledger that hasn't used any yet, so the picker
 * never calls an unused category "most used".
 */
export function mostUsedCategories(ledger: Pick<Ledger, "categories" | "transactions">, kind?: Kind, limit = 4): Category[] {
  const used = new Set(ledger.transactions.map((entry) => entry.categoryId));
  return frequentCategories(ledger, kind)
    .filter((category) => used.has(category.id))
    .slice(0, limit);
}

/** The first `limit` frequent categories, plus `selected` when it isn't among them, so the choice stays visible. */
export function inlineCategories(categories: Category[], selected: string | undefined, limit = 5): Category[] {
  const shown = categories.slice(0, limit);
  const chosen = categories.find((category) => category.id === selected);
  return chosen && !shown.includes(chosen) ? [...shown, chosen] : shown;
}

export function newDraft(ledger: Pick<Ledger, "categories" | "transactions">, kind: Kind = "expense", date = today()): EntryDraft {
  return {
    id: uid(),
    ruleId: uid(),
    kind,
    title: "",
    amount: "",
    date,
    categoryId: frequentCategories(ledger, kind)[0]?.id ?? "",
    accountId: "",
    tripId: "",
    note: "",
    split: "full",
    shareInput: "",
    repeat: "none",
    receipt: null,
  };
}

export function draftFromEntry(entry: Transaction): EntryDraft {
  const split: ShareMode = recordedSplit(entry);
  return {
    id: entry.id,
    ruleId: uid(),
    kind: entry.kind,
    title: entry.title,
    amount: centsToInput(entry.total),
    date: entry.date,
    categoryId: entry.categoryId,
    accountId: entry.accountId ?? "",
    tripId: entry.tripId ?? "",
    note: entry.note,
    split,
    shareInput: split === "equal" ? String(entry.participants) : split === "amount" ? centsToInput(entry.share) : "",
    repeat: "none",
    receipt: entry.receipt ?? null,
  };
}

/** Changing the kind keeps what was typed but picks a category of the new kind. Trips and splits are expense-only. */
export function withKind(draft: EntryDraft, kind: Kind, ledger: Pick<Ledger, "categories" | "transactions">): EntryDraft {
  if (kind === draft.kind) return draft;
  const fits = ledger.categories.some((category) => category.id === draft.categoryId && category.kind === kind);
  return { ...draft, kind, categoryId: fits ? draft.categoryId : (frequentCategories(ledger, kind)[0]?.id ?? "") };
}

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export interface BuiltEntry {
  transaction: Transaction;
  rule?: Recurring;
}

/**
 * Checks the draft against the ledger it will be saved to and builds the entry (and, for a new
 * repeating entry, its rule). Every problem is reported against its field.
 */
export function buildEntry(draft: EntryDraft, ledger: Ledger, original?: Transaction): { errors: DraftErrors; built?: BuiltEntry } {
  const errors: DraftErrors = {};
  let total = 0;
  try {
    total = cents(draft.amount);
    if (total <= 0) errors.amount = "Enter an amount greater than zero.";
  } catch (error) {
    errors.amount = message(error, "Enter an amount with up to two decimal places.");
  }
  const title = draft.title.trim();
  if (!title) errors.title = "Add a name for this entry.";
  else if (title.length > 100) errors.title = "Use up to 100 characters for the name.";
  if (!validDate(draft.date)) errors.date = "Choose a date between 2000 and 2100.";
  if (!ledger.categories.some((category) => category.id === draft.categoryId && category.kind === draft.kind)) errors.category = "Choose a category.";
  if (draft.accountId && !ledger.accounts.some((account) => account.id === draft.accountId)) errors.account = "This account isn't available any more. Choose another account.";
  const tripId = draft.kind === "expense" ? draft.tripId : "";
  if (tripId && !ledger.trips.some((trip) => trip.id === tripId)) errors.trip = "This trip isn't available any more. Choose another trip.";
  if (draft.note.trim().length > 1000) errors.note = "Keep the note to 1000 characters.";
  let share = total;
  const split = draft.kind === "expense" ? draft.split : "full";
  const participants = splitParticipants(split, draft.shareInput);
  if (!errors.amount) {
    try {
      share = personalShare(total, split, draft.shareInput);
    } catch (error) {
      errors.share = message(error, "Check your share.");
    }
  }
  if (Object.keys(errors).length) return { errors };

  const receipt = draft.kind === "expense" ? draft.receipt : null;
  const transaction: Transaction = {
    id: draft.id,
    title,
    kind: draft.kind,
    total,
    share,
    ...(participants !== undefined ? { participants } : {}),
    categoryId: draft.categoryId,
    ...(draft.accountId ? { accountId: draft.accountId } : {}),
    ...(tripId ? { tripId } : {}),
    date: draft.date,
    note: draft.note.trim(),
    ...(receipt ? { receipt } : {}),
    ...(original?.recurringId ? { recurringId: original.recurringId } : {}),
  };
  if (original || draft.repeat === "none") return { errors, built: { transaction } };
  const anchorDay = parseDate(draft.date).getDate();
  const rule: Recurring = {
    id: draft.ruleId,
    title,
    kind: draft.kind,
    total,
    share,
    ...(participants !== undefined ? { participants } : {}),
    categoryId: draft.categoryId,
    ...(draft.accountId ? { accountId: draft.accountId } : {}),
    date: draft.date,
    note: transaction.note,
    frequency: draft.repeat,
    nextDate: nextOccurrence(draft.date, draft.repeat, anchorDay),
    anchorDay,
    active: true,
  };
  return { errors, built: { transaction: { ...transaction, recurringId: rule.id }, rule } };
}

/**
 * The ledger change for a built entry. A repeated submit of the same draft is harmless: the entry
 * keeps its id (so it replaces itself) and the rule is added only once.
 */
export function entryChange({ transaction, rule }: BuiltEntry, original?: Transaction): LedgerChange {
  return (ledger) => {
    const newRule = rule && !ledger.recurring.some((item) => item.id === rule.id) ? rule : undefined;
    // The server refuses a ledger over the limit, which would hold back every pending change.
    if (newRule && ledger.recurring.length >= MAX_SCHEDULES) throw new Error(`You can have up to ${String(MAX_SCHEDULES)} schedules. Remove one first, or save this entry without repeating.`);
    return saveEntry(transaction, original, newRule)(ledger);
  };
}

/**
 * Undo for the saved toast (redesign card `iphone-saved-toast`): takes back what `entryChange`
 * did. An edit puts `original` back. A new entry is removed, and so is its schedule when this save
 * created it (`ruleWasNew`), with any entries the schedule filled in.
 */
export function undoEntryChange({ transaction, rule }: BuiltEntry, original: Transaction | undefined, ruleWasNew: boolean): LedgerChange {
  return (ledger) => {
    if (original) {
      if (!ledger.transactions.some((entry) => entry.id === original.id)) throw new Error("This entry was deleted, so the edit can't be undone.");
      return saveEntry(original)(ledger);
    }
    const ruleId = rule && ruleWasNew ? rule.id : undefined;
    return {
      ...ledger,
      transactions: ledger.transactions.filter((entry) => entry.id !== transaction.id && (ruleId === undefined || entry.recurringId !== ruleId)),
      recurring: ruleId === undefined ? ledger.recurring : ledger.recurring.filter((item) => item.id !== ruleId),
    };
  };
}

/** Ledger icons are Ionicons names ("basket-outline"); the web's set has the outline glyphs without the suffix. */
export function categoryIcon(icon: string | undefined): IconName {
  const name = (icon ?? "").replace(/-outline$/, "");
  return name in ICON_SVG ? (name as IconName) : "pricetag";
}

/** "Your share" line for an expense split with others, or null when the whole amount is yours. */
export function shareSummary(entry: Pick<Transaction, "kind" | "share" | "total">, money: (value: number) => string): string | null {
  if (entry.kind !== "expense" || entry.share === entry.total) return null;
  return `Your share ${money(entry.share)} of ${money(entry.total)}`;
}

/**
 * How an expense is split, as the detail's Split row and Activity's Split column read it
 * (`iphone-entry-detail`, `web-activity`). The ledger keeps only the share and the total, so an
 * equal split is recognised from them (`personalShare` rounds the total over the people); any other
 * share is a custom one. `null` when the entry isn't split.
 */
export function splitSummary(entry: Pick<Transaction, "kind" | "share" | "total" | "participants">): { method: string; people: number | null } | null {
  if (entry.kind !== "expense" || entry.share === entry.total || entry.share <= 0) return null;
  // The recorded count (MAZ-272) when it still gives the share; else read from the amounts, for entries saved before it.
  const people = recordedSplit(entry) === "equal" && entry.participants !== undefined ? entry.participants : Math.round(entry.total / entry.share);
  if (people >= 2 && people <= 100 && Math.round(entry.total / people) === entry.share) return { method: `Equally · ${String(people)} people`, people };
  return { method: "Custom share", people: null };
}

export const FREQUENCY_LABELS: Record<Frequency, string> = { weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };

/** What an entry's repeat reads as: its schedule's frequency, "Repeating" if the schedule is gone, or "Never". */
export function repeatLabel(entry: Pick<Transaction, "recurringId">, ledger: Pick<Ledger, "recurring"> | null): string {
  if (!entry.recurringId) return "Never";
  const rule = ledger?.recurring.find((item) => item.id === entry.recurringId);
  return rule ? FREQUENCY_LABELS[rule.frequency] : "Repeating";
}

/** A ledger date as the detail's subtitle reads it, e.g. "Monday, Nov 9" (with the year when it isn't `today`'s). */
export function longDay(date: string, today: string): string {
  const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-CA", {
    weekday: "long",
    month: "short",
    day: "numeric",
    ...(date.startsWith(today.slice(0, 4)) ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}
