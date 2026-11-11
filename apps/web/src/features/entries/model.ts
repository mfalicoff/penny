import { saveEntry, type LedgerChange } from "@domain/commands.ts";
import {
  cents,
  kindLabels,
  nextOccurrence,
  parseDate,
  personalShare,
  uid,
  validDate,
  type Category,
  type Frequency,
  type Kind,
  type Ledger,
  type Recurring,
  type Transaction,
} from "@domain/ledger.ts";
import { ICON_SVG } from "@design-kit/src/icons";
import type { IconName } from "../../design/Icon";

/**
 * The personal entry form's draft and its validation (MAZ-88). The rules are the legacy app's
 * (`src/features/entries/entryDraft.ts`) on top of the shared domain (`@domain/ledger.ts`,
 * `@domain/commands.ts`): integer cents, the personal share modes, a repeat that creates a rule
 * whose first occurrence is this entry, and trips and receipts on expenses only. Saving goes
 * through the durable offline store as a `LedgerChange`, never straight to the API.
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
  };
}

export function draftFromEntry(entry: Transaction): EntryDraft {
  const split: ShareMode = entry.kind === "expense" && entry.share !== entry.total ? "amount" : "full";
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
    shareInput: split === "amount" ? centsToInput(entry.share) : "",
    repeat: "none",
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
  if (!errors.amount) {
    try {
      share = personalShare(total, draft.kind === "expense" ? draft.split : "full", draft.shareInput);
    } catch (error) {
      errors.share = message(error, "Check your share.");
    }
  }
  if (Object.keys(errors).length) return { errors };

  const receipt = draft.kind === "expense" ? original?.receipt : undefined;
  const transaction: Transaction = {
    id: draft.id,
    title,
    kind: draft.kind,
    total,
    share,
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
  return (ledger) => saveEntry(transaction, original, rule && !ledger.recurring.some((item) => item.id === rule.id) ? rule : undefined)(ledger);
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
