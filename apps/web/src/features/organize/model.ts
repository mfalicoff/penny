import { saveAccount, saveCategory, type LedgerChange } from "@domain/commands.ts";
import { accountTypeLabels, kindLabels, type AccountType, type Category, type Kind, type Ledger, type PaymentAccount } from "@domain/ledger.ts";
import { ICON_NAMES } from "@design-kit/src/icons";
import type { IconName } from "../../design/Icon";

/**
 * Rules and labels for payment accounts and categories (MAZ-89). The record rules themselves
 * (names, duplicates, in-use protection, stale edits) are the shared commands in `src/domain`;
 * this module only adds what the screens need around them: usage counts, the icon and color
 * choices, and moving links before a removal.
 */

export const NAME_MAX = 50;
/** The server's limit for accounts and for categories (`docs/migration/ledger.md`). */
export const RECORD_LIMIT = 300;

export { accountTypeLabels, kindLabels };

/** Account types drawn with the design kit's glyphs (the legacy `business-outline` isn't in the kit). */
export const ACCOUNT_TYPE_ICONS: Record<AccountType, IconName> = {
  bank: "wallet",
  credit: "card",
  cash: "cash",
  other: "ellipsis-horizontal",
};

/**
 * The category palette from the design baseline (`contracts/design-baseline.json`
 * `categoryColors`). It never reuses a meaning color (income green, investment indigo, pending
 * amber, danger red), so a color on screen keeps one meaning. Names are for screen readers.
 */
export const CATEGORY_COLORS: { value: string; name: string }[] = [
  { value: "#3B82F6", name: "Blue" },
  { value: "#0FA3A3", name: "Teal" },
  { value: "#64748B", name: "Slate" },
  { value: "#E0529C", name: "Pink" },
  { value: "#A0704C", name: "Brown" },
  { value: "#7A8F3A", name: "Olive" },
  { value: "#0E7490", name: "Ocean" },
  { value: "#8E8A85", name: "Gray" },
];

/** Glyphs offered for categories (card `iphone-category-form`), with their spoken names. */
export const CATEGORY_ICONS: { name: IconName; label: string }[] = [
  { name: "home", label: "Home" },
  { name: "basket", label: "Basket" },
  { name: "bus", label: "Bus" },
  { name: "cafe", label: "Coffee" },
  { name: "bag-handle", label: "Shopping bag" },
  { name: "musical-notes", label: "Music" },
  { name: "heart", label: "Heart" },
  { name: "airplane", label: "Airplane" },
  { name: "leaf", label: "Leaf" },
  { name: "people", label: "People" },
  { name: "receipt", label: "Receipt" },
  { name: "card", label: "Card" },
  { name: "cash", label: "Cash" },
  { name: "gift", label: "Gift" },
  { name: "briefcase", label: "Briefcase" },
  { name: "laptop", label: "Laptop" },
  { name: "trending-up", label: "Trending up" },
  { name: "wallet", label: "Wallet" },
  { name: "pricetag", label: "Price tag" },
  { name: "document-text", label: "Document" },
  { name: "sunny", label: "Sun" },
  { name: "moon", label: "Moon" },
  { name: "time", label: "Clock" },
  { name: "key", label: "Key" },
  { name: "image", label: "Picture" },
  { name: "ellipsis-horizontal", label: "More" },
];

const known = new Set<string>(ICON_NAMES);

/**
 * The glyph for a stored category icon. Ledgers store Ionicons names (`basket-outline`, as the
 * legacy and native apps do); the web draws the kit's outline set, so the suffix is dropped. An
 * icon the kit doesn't have shows the price tag rather than nothing.
 */
export function categoryIcon(stored: string): IconName {
  const name = stored.replace(/-outline$/, "");
  return known.has(name) ? (name as IconName) : "pricetag";
}

/** How a chosen glyph is stored, matching the names the other clients already write. */
export const storedIcon = (name: IconName): string => `${name}-outline`;

export interface Usage {
  entries: number;
  schedules: number;
}

const NONE: Usage = Object.freeze({ entries: 0, schedules: 0 });

function count(ledger: Ledger, field: "accountId" | "categoryId"): Map<string, Usage> {
  const counts = new Map<string, Usage>();
  const bump = (id: string | undefined, key: keyof Usage) => {
    if (!id) return;
    const current = counts.get(id) ?? { entries: 0, schedules: 0 };
    current[key] += 1;
    counts.set(id, current);
  };
  for (const entry of ledger.transactions) bump(entry[field], "entries");
  for (const rule of ledger.recurring) bump(rule[field], "schedules");
  return counts;
}

export const accountUsage = (ledger: Ledger) => count(ledger, "accountId");
export const categoryUsage = (ledger: Ledger) => count(ledger, "categoryId");
export const usageOf = (usage: Map<string, Usage>, id: string): Usage => usage.get(id) ?? NONE;
export const inUse = (usage: Usage) => usage.entries > 0 || usage.schedules > 0;

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/** "42 entries, 2 schedules", "3 entries", "not used yet" (card `iphone-accounts`). */
export function usageText(usage: Usage): string {
  const parts = [usage.entries ? plural(usage.entries, "entry", "entries") : null, usage.schedules ? plural(usage.schedules, "schedule", "schedules") : null].filter(Boolean);
  return parts.length ? parts.join(", ") : "not used yet";
}

/** "31 entries and 3 schedules": what removing would leave without an account or category. */
export function usageSentence(usage: Usage): string {
  return usageText(usage).replace(", ", " and ");
}

/** Trimmed, case-insensitive name comparison, as the shared commands check duplicates. */
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function accountNameProblem(ledger: Ledger, name: string, id?: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give your account a name.";
  if (trimmed.length > NAME_MAX) return `Use up to ${String(NAME_MAX)} characters.`;
  if (ledger.accounts.some((account) => account.id !== id && sameName(account.name, trimmed))) return "You already have an account with this name.";
  return null;
}

export function categoryNameProblem(ledger: Ledger, name: string, kind: Kind, id?: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give your category a name.";
  if (trimmed.length > NAME_MAX) return `Use up to ${String(NAME_MAX)} characters.`;
  if (ledger.categories.some((category) => category.id !== id && category.kind === kind && sameName(category.name, trimmed)))
    return `You already have an ${kindLabels[kind].toLowerCase()} category with this name.`;
  return null;
}

/** Records whose saved copy differs from the server's last acknowledged ledger: "Waiting to sync". */
export function unsyncedIds<T extends { id: string }>(local: readonly T[], server: readonly T[] | null): Set<string> {
  if (!server) return new Set();
  const before = new Map(server.map((item) => [item.id, JSON.stringify(item)]));
  return new Set(local.filter((item) => before.get(item.id) !== JSON.stringify(item)).map((item) => item.id));
}

/** What a reassignment moved, so Undo can put every link back. */
export interface Moved {
  entryIds: string[];
  scheduleIds: string[];
}

/**
 * Moves every entry and schedule from `from` to `to`, then removes `from`, in one change: either
 * both happen or neither does. The removal still goes through the shared command, so a stale form
 * or a link that appeared meanwhile (another tab) is refused instead of overwritten.
 */
export function moveAccountAndRemove(from: PaymentAccount, to: PaymentAccount, moved?: (value: Moved) => void): LedgerChange {
  return (ledger) => {
    if (!ledger.accounts.some((account) => account.id === to.id))
      throw new Error(`${to.name} was removed on another device. Choose another account.`);
    const record: Moved = { entryIds: [], scheduleIds: [] };
    const next: Ledger = {
      ...ledger,
      transactions: ledger.transactions.map((entry) => {
        if (entry.accountId !== from.id) return entry;
        record.entryIds.push(entry.id);
        return { ...entry, accountId: to.id };
      }),
      recurring: ledger.recurring.map((rule) => {
        if (rule.accountId !== from.id) return rule;
        record.scheduleIds.push(rule.id);
        return { ...rule, accountId: to.id };
      }),
    };
    const result = saveAccount(from, from, true)(next);
    moved?.(record);
    return result;
  };
}

/** Undo for `moveAccountAndRemove`: brings the account back and returns the moved links to it. */
export function restoreAccount(account: PaymentAccount, moved: Moved = { entryIds: [], scheduleIds: [] }, movedTo?: string): LedgerChange {
  return (ledger) => {
    if (ledger.accounts.some((item) => item.id === account.id)) return ledger;
    const entries = new Set(moved.entryIds);
    const schedules = new Set(moved.scheduleIds);
    return {
      ...ledger,
      accounts: [...ledger.accounts, account],
      transactions: ledger.transactions.map((entry) => (entries.has(entry.id) && entry.accountId === movedTo ? { ...entry, accountId: account.id } : entry)),
      recurring: ledger.recurring.map((rule) => (schedules.has(rule.id) && rule.accountId === movedTo ? { ...rule, accountId: account.id } : rule)),
    };
  };
}

/** The category counterpart of `moveAccountAndRemove`; the target must have the same kind. */
export function moveCategoryAndRemove(from: Category, to: Category, moved?: (value: Moved) => void): LedgerChange {
  return (ledger) => {
    if (!ledger.categories.some((category) => category.id === to.id && category.kind === from.kind))
      throw new Error(`${to.name} was removed on another device. Choose another category.`);
    const record: Moved = { entryIds: [], scheduleIds: [] };
    const next: Ledger = {
      ...ledger,
      transactions: ledger.transactions.map((entry) => {
        if (entry.categoryId !== from.id) return entry;
        record.entryIds.push(entry.id);
        return { ...entry, categoryId: to.id };
      }),
      recurring: ledger.recurring.map((rule) => {
        if (rule.categoryId !== from.id) return rule;
        record.scheduleIds.push(rule.id);
        return { ...rule, categoryId: to.id };
      }),
    };
    const result = saveCategory(from, from, true)(next);
    moved?.(record);
    return result;
  };
}

export function restoreCategory(category: Category, moved: Moved = { entryIds: [], scheduleIds: [] }, movedTo?: string): LedgerChange {
  return (ledger) => {
    if (ledger.categories.some((item) => item.id === category.id)) return ledger;
    const entries = new Set(moved.entryIds);
    const schedules = new Set(moved.scheduleIds);
    return {
      ...ledger,
      categories: [...ledger.categories, category],
      transactions: ledger.transactions.map((entry) => (entries.has(entry.id) && entry.categoryId === movedTo ? { ...entry, categoryId: category.id } : entry)),
      recurring: ledger.recurring.map((rule) => (schedules.has(rule.id) && rule.categoryId === movedTo ? { ...rule, categoryId: category.id } : rule)),
    };
  };
}

/** The server's refusal when a shared expense or shared rule you paid still links the account. */
export const HOUSEHOLD_LINK_MESSAGE = "Remove household expense links before deleting this payment account.";

/**
 * Accounts the server still has that this browser removed, when the server refused the sync
 * because a shared expense links them. Putting them back lets the rest of the work sync.
 */
export function refusedAccountRemovals(issueMessage: string | undefined, local: Ledger, server: Ledger | null): PaymentAccount[] {
  if (!issueMessage?.includes(HOUSEHOLD_LINK_MESSAGE) || !server) return [];
  const kept = new Set(local.accounts.map((account) => account.id));
  return server.accounts.filter((account) => !kept.has(account.id));
}
