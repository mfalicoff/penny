import { nextOccurrence, type Frequency, type Kind, type Ledger, type Recurring, type Transaction } from "./ledger.ts";

// Recurring suggestions: personal entries that repeat with the same name, a regular gap and a
// steady amount, offered as schedules on Recurring. Detection runs on the device only; the server
// never analyses the ledger. The native app (`RecurringSuggestions.swift`) runs the same rules,
// checked against contracts/fixtures/recurring-suggestions.json.
//
// 1. Group the personal ledger's own entries by kind and a normalised title (`suggestionKey`). An
//    entry a schedule recorded (`recurringId`), an entry dated after today, and a group an existing
//    schedule already covers (same kind and key) are left out. Household shares never are in the
//    personal ledger, so they're left out too.
// 2. The interval is the median gap between the sorted dates: weekly 6–8 days, monthly 27–33,
//    yearly 358–372. At least 80% of the gaps fit it.
// 3. At least 3 entries weekly or monthly, 2 yearly, the latest within 1.5 intervals of today.
// 4. The amount (`share`) is steady: the newest entries, from a single price step on, are each
//    within 10% or $2 of the median of the last 3, and the entries before the step agree with their
//    own median the same way. The suggestion takes the newest amount and, after a step that held
//    (the two newest amounts equal), the amount before it as `previousShare` ("was $15.49").
// 5. The anchor day is the most common day of the month (ties: the larger day, which also covers
//    the shorter months); weekly, the next date's day, as the schedule form stores it. The next
//    date is the first anchored date after both the latest entry and today. Integer cents only.
// 6. The id is `{kind}|{key}|{frequency}`.
//
// A dismissal is stored in `dismissedSuggestions` as `{id}|{share}`. It hides the suggestion while
// the newest amount stays within 25% of the dismissed one.
//
// O(n log n) in the number of entries. Pure: `today` is passed in.

export type RecurringSuggestion = {
  id: string;
  kind: Kind;
  key: string;
  frequency: Frequency;
  /** The newest entry's title, as typed. */
  title: string;
  total: number;
  share: number;
  participants?: number;
  /** The most common category of the matched entries (ties: the newest such entry's). */
  categoryId: string;
  /** The newest entry's account. */
  accountId?: string;
  /** The amount before a price step that held, for "was $15.49". */
  previousShare?: number;
  anchorDay: number;
  /** The first anchored date after both the latest matched entry and today. */
  nextDate: string;
  count: number;
  firstDate: string;
  lastDate: string;
  /** The matched entries, newest first. */
  entryIds: string[];
};

export const MAX_DISMISSED_SUGGESTIONS = 500;
export const MAX_DISMISSAL_LENGTH = 200;

const STOP_WORDS = new Set([
  "inc", "ltd", "llc", "corp", "co", "com", "subscription", "subscriptions", "payment", "payments",
  "autopay", "bill", "monthly", "weekly", "yearly", "annual", "renewal", "membership",
]);

/** Lower case, diacritics removed, every run of non-letters a word break, and the stop words dropped. */
export function suggestionKey(title: string): string {
  return title.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .split(/[^\p{L}]+/u).filter((word) => word !== "" && !STOP_WORDS.has(word)).join(" ");
}

const NOMINAL: Record<Frequency, number> = { weekly: 7, monthly: 30, yearly: 365 };
const MIN_COUNT: Record<Frequency, number> = { weekly: 3, monthly: 3, yearly: 2 };

function dayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(year, month - 1, day) / 86400000);
}

/** The lower median of a non-empty list. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] as number;
}

function frequencyOf(gap: number): Frequency | null {
  if (gap >= 6 && gap <= 8) return "weekly";
  if (gap >= 27 && gap <= 33) return "monthly";
  if (gap >= 358 && gap <= 372) return "yearly";
  return null;
}

const near = (amount: number, reference: number) => {
  const difference = Math.abs(amount - reference);
  return difference <= 200 || difference * 10 <= reference;
};

/** `{id}|{share}`: what `dismissedSuggestions` stores for a dismissal. */
export function dismissalOf(suggestion: Pick<RecurringSuggestion, "id" | "share">): string {
  return `${suggestion.id}|${String(suggestion.share)}`;
}

/** Whether a stored dismissal hides `suggestion`: same id, and the amount moved by at most 25%. */
export function isDismissed(suggestion: Pick<RecurringSuggestion, "id" | "share">, dismissed: readonly string[]): boolean {
  const prefix = `${suggestion.id}|`;
  return dismissed.some((item) => {
    if (!item.startsWith(prefix)) return false;
    const rest = item.slice(prefix.length);
    if (!/^\d{1,11}$/.test(rest)) return false;
    const amount = Number(rest);
    return Math.abs(suggestion.share - amount) * 4 <= amount;
  });
}

/** One group's suggestion, or null. `entries` share a kind and key, sorted by date then id. */
function suggest(kind: Kind, key: string, entries: Transaction[], today: string): RecurringSuggestion | null {
  if (entries.length < 2) return null;
  const days = entries.map((entry) => dayNumber(entry.date));
  const gaps = days.slice(1).map((day, index) => day - (days[index] as number));
  const frequency = frequencyOf(median(gaps));
  if (!frequency) return null;
  const fits = gaps.filter((gap) => frequencyOf(gap) === frequency).length;
  if (fits * 5 < gaps.length * 4 || entries.length < MIN_COUNT[frequency]) return null;
  const latest = entries[entries.length - 1] as Transaction;
  if ((dayNumber(today) - (days[days.length - 1] as number)) * 2 > NOMINAL[frequency] * 3) return null;

  const amounts = entries.map((entry) => entry.share);
  const reference = median(amounts.slice(-3));
  let step = amounts.length;
  while (step > 0 && near(amounts[step - 1] as number, reference)) step -= 1;
  if (step === amounts.length) return null;
  if (step > 0) {
    if (amounts.length - step < 2) return null;
    const before = amounts.slice(0, step);
    const previous = median(before);
    if (!before.every((amount) => near(amount, previous))) return null;
  }
  const share = latest.share;
  let previousShare: number | undefined;
  if (amounts.length >= 3 && amounts[amounts.length - 2] === share) {
    for (let index = amounts.length - 3; index >= 0; index -= 1)
      if (amounts[index] !== share) {
        previousShare = amounts[index];
        break;
      }
  }

  const dayCounts = new Map<number, number>();
  for (const entry of entries) {
    const day = Number(entry.date.slice(8));
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }
  let anchorDay = 0;
  let anchorCount = 0;
  for (const [day, count] of dayCounts)
    if (count > anchorCount || (count === anchorCount && day > anchorDay)) {
      anchorDay = day;
      anchorCount = count;
    }

  const categoryCounts = new Map<string, number>();
  for (const entry of entries) categoryCounts.set(entry.categoryId, (categoryCounts.get(entry.categoryId) ?? 0) + 1);
  const most = Math.max(...categoryCounts.values());
  const categoryId = [...entries].reverse().find((entry) => categoryCounts.get(entry.categoryId) === most)?.categoryId ?? latest.categoryId;

  const after = latest.date > today ? latest.date : today;
  let nextDate = latest.date;
  while (nextDate <= after) nextDate = nextOccurrence(nextDate, frequency, anchorDay);
  // Weekly dates ignore the anchor; store the next date's day, as the schedule form does.
  if (frequency === "weekly") anchorDay = Number(nextDate.slice(8));

  return {
    id: `${kind}|${key}|${frequency}`,
    kind,
    key,
    frequency,
    title: latest.title,
    total: latest.total,
    share,
    ...(latest.participants !== undefined ? { participants: latest.participants } : {}),
    categoryId,
    ...(latest.accountId !== undefined ? { accountId: latest.accountId } : {}),
    ...(previousShare !== undefined ? { previousShare } : {}),
    anchorDay,
    nextDate,
    count: entries.length,
    firstDate: (entries[0] as Transaction).date,
    lastDate: latest.date,
    entryIds: entries.map((entry) => entry.id).reverse(),
  };
}

/** Every suggestion the ledger has today, dismissed ones left out: the longest-running first (earliest first entry), then by id. */
export function recurringSuggestions(ledger: Ledger, today: string): RecurringSuggestion[] {
  const covered = new Set(ledger.recurring.map((rule: Recurring) => `${rule.kind}|${suggestionKey(rule.title)}`));
  const groups = new Map<string, { kind: Kind; key: string; entries: Transaction[] }>();
  for (const entry of ledger.transactions) {
    if (entry.recurringId !== undefined || entry.date > today) continue;
    const key = suggestionKey(entry.title);
    if (!key) continue;
    const group = `${entry.kind}|${key}`;
    if (covered.has(group)) continue;
    let found = groups.get(group);
    if (!found) groups.set(group, found = { kind: entry.kind, key, entries: [] });
    found.entries.push(entry);
  }
  const dismissed = ledger.dismissedSuggestions ?? [];
  const result: RecurringSuggestion[] = [];
  for (const { kind, key, entries } of groups.values()) {
    entries.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const suggestion = suggest(kind, key, entries, today);
    if (suggestion && !isDismissed(suggestion, dismissed)) result.push(suggestion);
  }
  return result.sort((a, b) => a.firstDate !== b.firstDate ? (a.firstDate < b.firstDate ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The schedule accepting `suggestion` saves (the form opens with it filled in). Past entries aren't linked. */
export function suggestedRule(suggestion: RecurringSuggestion, id: string): Recurring {
  return {
    id,
    title: suggestion.title,
    kind: suggestion.kind,
    total: suggestion.total,
    share: suggestion.share,
    ...(suggestion.participants !== undefined ? { participants: suggestion.participants } : {}),
    categoryId: suggestion.categoryId,
    accountId: suggestion.accountId,
    date: suggestion.nextDate,
    note: "",
    frequency: suggestion.frequency,
    nextDate: suggestion.nextDate,
    anchorDay: suggestion.anchorDay,
    active: true,
  };
}

/** Appends `{id}|{share}`, keeping the newest 500 (the ledger's limit). */
export function withDismissal(dismissed: readonly string[], dismissal: string): string[] {
  const next = [...dismissed.filter((item) => item !== dismissal), dismissal];
  return next.slice(Math.max(0, next.length - MAX_DISMISSED_SUGGESTIONS));
}

/**
 * Three-way merge of `dismissedSuggestions`: a set union of both sides, except what this device
 * removed (an Undo) since the base. The server's order first, then this device's additions; the
 * newest 500 stay. Absent when neither side has any.
 */
export function mergeDismissals(base: readonly string[] | undefined, local: readonly string[] | undefined, remote: readonly string[] | undefined): string[] | undefined {
  if (base === undefined && local === undefined && remote === undefined) return undefined;
  const mine = new Set(local ?? []);
  const undone = new Set((base ?? []).filter((item) => !mine.has(item)));
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const item of [...(remote ?? []), ...(local ?? [])]) {
    if (seen.has(item) || undone.has(item)) continue;
    seen.add(item);
    merged.push(item);
  }
  return merged.slice(Math.max(0, merged.length - MAX_DISMISSED_SUGGESTIONS));
}
