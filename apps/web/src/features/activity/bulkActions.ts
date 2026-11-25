import { saveEntry, type LedgerChange } from "@domain/commands.ts";
import type { Category, Kind, Ledger, Transaction } from "@domain/ledger.ts";
import type { IconName } from "../../design/Icon";
import { categoryIcon, repeatLabel } from "../entries/model";
import { ACCOUNT_TYPE_ICONS } from "../organize/model";

/**
 * Activity's bulk actions (MAZ-276, cards `web-activity-selected`, `web-activity-bulk-category`,
 * `web-activity-bulk-account`, `web-activity-bulk-delete` and `web-activity-bulk-done`).
 *
 * The selection bar draws whatever `BULK_ACTIONS` holds, in its order, so adding an action (for
 * example exporting only the selected entries) is one more definition here: the bar, the picker,
 * the confirmation and the selection logic don't change. Each action turns the selection into one
 * `LedgerChange`, saved once through the offline store, so the outbox and conflict merge treat it
 * like any other change; `restoreEntries` undoes it, again in one save.
 */

/** The selected entries, as this browser's ledger has them now. */
export interface Selection {
  ledger: Ledger;
  entries: Transaction[];
}

/** What an action does once chosen: the change to save and the saved toast's title. */
export interface BulkOutcome {
  change: LedgerChange;
  done: string;
}

/** One row of a picker: a category or an account (`id` "" is "No account"). */
export interface PickOption {
  id: string;
  label: string;
  icon: IconName;
  /** A category's tile, tinted as its rows are; accounts use a neutral tile. */
  category?: Category;
  /** How many selected entries already use it ("1 of 3"), 0 for none. */
  count: number;
}

interface BaseAction {
  id: string;
  label: string;
  icon: IconName;
  /** Destructive: drawn red, after the others. */
  danger?: boolean;
  /** Why the action can't apply to this selection, or null when it can. */
  unavailable?: (selection: Selection) => string | null;
}

/** Opens a menu under its button; choosing a row applies it (`web-activity-bulk-category`). */
export interface PickAction extends BaseAction {
  kind: "pick";
  title: (selection: Selection) => string;
  /** A search field over the options, with this placeholder. */
  search?: string;
  options: (selection: Selection) => PickOption[];
  /** A line at the end of the menu, e.g. that schedules keep their own category. */
  note?: (selection: Selection) => string | null;
  apply: (selection: Selection, optionId: string) => BulkOutcome;
}

/** Asks first, listing the entries (`web-activity-bulk-delete`). */
export interface ConfirmAction extends BaseAction {
  kind: "confirm";
  title: (selection: Selection) => string;
  description: string;
  confirmLabel: (selection: Selection) => string;
  note?: (selection: Selection) => string | null;
  apply: (selection: Selection) => BulkOutcome;
}

/** Applies at once, with no menu or confirmation. */
export interface RunAction extends BaseAction {
  kind: "run";
  apply: (selection: Selection) => BulkOutcome;
}

export type BulkAction = PickAction | ConfirmAction | RunAction;

export const entries = (count: number) => `${String(count)} ${count === 1 ? "entry" : "entries"}`;

const KIND_NOUNS: Record<Kind, [string, string]> = {
  expense: ["expense", "expenses"],
  income: ["income entry", "income entries"],
  investment: ["investment", "investments"],
};

/** "3 expenses" when the selection is of one type, else "3 entries". */
function counted(selection: Selection): string {
  const count = selection.entries.length;
  const kind = onlyKind(selection.entries);
  if (!kind) return entries(count);
  const [one, many] = KIND_NOUNS[kind];
  return `${String(count)} ${count === 1 ? one : many}`;
}

function onlyKind(list: Transaction[]): Kind | null {
  const kinds = new Set(list.map((entry) => entry.kind));
  return kinds.size === 1 ? (list[0]?.kind ?? null) : null;
}

export class SelectionChanged extends Error {
  constructor() {
    super("Some of these entries changed on another device, so nothing was changed. Check them and try again.");
    this.name = "SelectionChanged";
  }
}

/**
 * One change for the whole selection: it fails, changing nothing, when any entry is no longer as
 * it was when chosen (edited or deleted on another device), then applies `each` to every entry.
 */
function batch(originals: Transaction[], each: (entry: Transaction) => LedgerChange | null): LedgerChange {
  return (ledger) => {
    for (const original of originals) {
      const current = ledger.transactions.find((item) => item.id === original.id);
      if (JSON.stringify(current) !== JSON.stringify(original)) throw new SelectionChanged();
    }
    return originals.reduce((next, entry) => each(entry)?.(next) ?? next, ledger);
  };
}

/** Undo: every entry back as it was before the action, in one save. */
export function restoreEntries(originals: Transaction[]): LedgerChange {
  return (ledger) => originals.reduce((next, entry) => saveEntry(entry)(next), ledger);
}

const FREQUENCY_UNITS: Record<string, string> = { Weekly: "week", Monthly: "month", Yearly: "year" };

/** The entries a schedule created: the action changes them alone, and the schedule keeps going. */
function scheduleNote(selection: Selection, one: (entry: Transaction, frequency: string) => string, many: (count: number) => string): string | null {
  const repeating = selection.entries.filter((entry) => entry.recurringId);
  const [first] = repeating;
  if (!first) return null;
  return repeating.length === 1 ? one(first, repeatLabel(first, selection.ledger)) : many(repeating.length);
}

const changeCategory: PickAction = {
  id: "category",
  kind: "pick",
  label: "Change category",
  icon: "pricetag",
  unavailable: (selection) => (onlyKind(selection.entries) ? null : "Select entries of one type to change their category"),
  title: (selection) => `Category for ${counted(selection)}`,
  search: "Find a category",
  options: ({ ledger, entries: list }) => {
    const kind = onlyKind(list);
    return ledger.categories
      .filter((category) => category.kind === kind)
      .map((category) => ({ id: category.id, label: category.name, icon: categoryIcon(category.icon), category, count: list.filter((entry) => entry.categoryId === category.id).length }));
  },
  note: (selection) =>
    scheduleNote(
      selection,
      (entry, frequency) => `${entry.title} repeats ${frequency.toLowerCase()}. Its schedule keeps its own category.`,
      (count) => `${String(count)} of these repeat. Their schedules keep their own categories.`,
    ),
  apply: (selection, categoryId) => {
    const name = selection.ledger.categories.find((category) => category.id === categoryId)?.name ?? "the category";
    return {
      change: batch(selection.entries, (entry) => (entry.categoryId === categoryId ? null : saveEntry({ ...entry, categoryId }))),
      done: `${entries(selection.entries.length)} moved to ${name}`,
    };
  },
};

const changeAccount: PickAction = {
  id: "account",
  kind: "pick",
  label: "Change account",
  icon: "wallet",
  title: (selection) => `Account for ${entries(selection.entries.length)}`,
  options: ({ ledger, entries: list }) => [
    ...ledger.accounts.map((account) => ({ id: account.id, label: account.name, icon: ACCOUNT_TYPE_ICONS[account.type], count: list.filter((entry) => entry.accountId === account.id).length })),
    { id: "", label: "No account", icon: "close" as const, count: 0 },
  ],
  note: (selection) =>
    scheduleNote(
      selection,
      (entry, frequency) => `${entry.title} repeats ${frequency.toLowerCase()}. Its schedule keeps its own account.`,
      (count) => `${String(count)} of these repeat. Their schedules keep their own accounts.`,
    ),
  apply: (selection, accountId) => {
    const name = selection.ledger.accounts.find((account) => account.id === accountId)?.name;
    return {
      change: batch(selection.entries, (entry) => {
        if ((entry.accountId ?? "") === accountId) return null;
        const next: Transaction = { ...entry };
        delete next.accountId;
        if (accountId) next.accountId = accountId;
        return saveEntry(next);
      }),
      done: name ? `${entries(selection.entries.length)} moved to ${name}` : `Account removed from ${entries(selection.entries.length)}`,
    };
  },
};

const deleteSelected: ConfirmAction = {
  id: "delete",
  kind: "confirm",
  label: "Delete",
  icon: "trash",
  danger: true,
  title: (selection) => `Delete ${entries(selection.entries.length)}?`,
  description: "They're removed from your ledger on every device.",
  confirmLabel: (selection) => `Delete ${entries(selection.entries.length)}`,
  note: (selection) =>
    scheduleNote(
      selection,
      (entry, frequency) => `${entry.title} repeats ${frequency.toLowerCase()}. Only this ${FREQUENCY_UNITS[frequency] ?? "time"}'s entry is deleted; the schedule keeps going.`,
      (count) => `${String(count)} of these repeat. Only these entries are deleted; their schedules keep going.`,
    ),
  apply: (selection) => {
    const ids = new Set(selection.entries.map((entry) => entry.id));
    return {
      change: (ledger) => {
        const checked = batch(selection.entries, () => null)(ledger);
        return { ...checked, transactions: checked.transactions.filter((entry) => !ids.has(entry.id)) };
      },
      done: `${entries(selection.entries.length)} deleted`,
    };
  },
};

/** The selection bar's actions, in order: destructive ones last. Add a definition to add an action. */
export const BULK_ACTIONS: readonly BulkAction[] = [changeCategory, changeAccount, deleteSelected];

/** "spent $117.30", with "in" and "invested" when the selection has them (`web-activity-selected`). */
export function selectionTotals(list: Transaction[]): { expense: number; income: number; investment: number } {
  const sums = { expense: 0, income: 0, investment: 0 };
  for (const entry of list) sums[entry.kind] += entry.share;
  return sums;
}
