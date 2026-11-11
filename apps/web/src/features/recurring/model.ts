import type { LedgerChange } from "@domain/commands.ts";
import { cents, dateKey, nextOccurrence, parseDate, personalShare, uid, validDate, type Category, type Frequency, type Kind, type Ledger, type PaymentAccount, type Recurring } from "@domain/ledger.ts";

/**
 * Personal recurring schedules (MAZ-90): labels, upcoming dates and the schedule form's draft.
 * Recurrence itself (`nextOccurrence`, `materialize`, pause and remove) is the shared domain code;
 * this module only builds and describes rules. Dates are the browser's local calendar days
 * (`dateKey`), as in the native and legacy apps.
 */

export const KIND_ORDER: Kind[] = ["income", "expense", "investment"];
export const KIND_HEADINGS: Record<Kind, string> = { income: "Income", expense: "Expenses", investment: "Investments" };
export const FREQUENCY_LABELS: Record<Frequency, string> = { weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
/** The ledger's limits (server/validation/ledger.ts). */
export const MAX_SCHEDULES = 1000;
export const MAX_TITLE = 100;
export const MAX_NOTE = 1000;
export const LAST_DATE = "2100-12-31";

export type SplitMode = "full" | "equal" | "amount" | "percent";

/** Money tone per kind: expenses in the label color, income and investments with their color and word. */
export const TONE = { expense: "expense", income: "income", investment: "investment" } as const satisfies Record<Kind, string>;

/** Which recurring dialog is open. One at a time, so focus returns to the row (or New schedule) when it closes. */
export type ScheduleView = { kind: "new" } | { kind: "detail"; id: string } | { kind: "edit"; rule: Recurring } | { kind: "remove"; rule: Recurring };

/** Parses a ledger date at local noon and formats it, e.g. "Tue, Nov 18" (with the year: "Tue, Nov 18, 2026"). */
export function dayLabel(date: string, withYear = false): string {
  return parseDate(date).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
}

export function shortDay(date: string): string {
  return parseDate(date).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

export function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${String(day)}th`;
  return `${String(day)}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
}

/** "Every week on Tuesday", "Every month on the 31st (the last day in shorter months)", "Every year on Mar 18". */
export function cadenceLabel(rule: Pick<Recurring, "frequency" | "nextDate" | "anchorDay">): string {
  if (rule.frequency === "weekly") return `Every week on ${parseDate(rule.nextDate).toLocaleDateString("en-CA", { weekday: "long" })}`;
  const short = rule.anchorDay > 28 ? " (the last day in shorter months)" : "";
  if (rule.frequency === "monthly") return `Every month on the ${ordinal(rule.anchorDay)}${short}`;
  const month = parseDate(rule.nextDate).toLocaleDateString("en-CA", { month: "short" });
  return `Every year on ${month} ${String(rule.anchorDay)}${short}`;
}

/** The rule's next `count` dates from `nextDate`, following the anchor-day rule; none past 2100. */
export function upcomingDates(rule: Pick<Recurring, "frequency" | "nextDate" | "anchorDay">, count = 3): string[] {
  const dates: string[] = [];
  let date = rule.nextDate;
  while (dates.length < count && date <= LAST_DATE) {
    dates.push(date);
    date = nextOccurrence(date, rule.frequency, rule.anchorDay);
  }
  return dates;
}

/** Where a paused rule would continue if resumed `today` (the shared `setScheduleActive` skips paused dates). */
export function resumeDate(rule: Pick<Recurring, "frequency" | "nextDate" | "anchorDay">, today = dateKey()): string {
  let date = rule.nextDate;
  while (date <= today) date = nextOccurrence(date, rule.frequency, rule.anchorDay);
  return date;
}

/** Days from `today` to `date`, both local calendar days. */
export function daysUntil(date: string, today = dateKey()): number {
  return Math.round((parseDate(date).getTime() - parseDate(today).getTime()) / 86_400_000);
}

export function relativeDay(date: string, today = dateKey()): string {
  const days = daysUntil(date, today);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1) return `in ${String(days)} days`;
  return days === -1 ? "yesterday" : `${String(-days)} days ago`;
}

/** Dates from `first` through `today` that saving a new schedule records at once (catch-up). */
export function datesDueBy(first: string, frequency: Frequency, anchorDay: number, today = dateKey()): string[] {
  const dates: string[] = [];
  for (let date = first; date <= today && dates.length < 1000; date = nextOccurrence(date, frequency, anchorDay)) dates.push(date);
  return dates;
}

/** The rules of one kind, active ones by next date, then paused ones by title. */
export function sortSchedules(rules: readonly Recurring[]): Recurring[] {
  return [...rules].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.active) return a.nextDate.localeCompare(b.nextDate) || a.title.localeCompare(b.title);
    return a.title.localeCompare(b.title);
  });
}

/* ---------- the schedule form ---------- */

export interface ScheduleDraft {
  kind: Kind;
  title: string;
  amount: string;
  /** New schedules: the first date. Editing: the next date. */
  date: string;
  frequency: Frequency;
  categoryId: string;
  accountId: string;
  note: string;
  split: SplitMode;
  shareInput: string;
}

export type DraftField = "title" | "amount" | "date" | "categoryId" | "accountId" | "share" | "note";
export type DraftErrors = Partial<Record<DraftField, string>>;

const toInput = (value: number) => (value / 100).toFixed(2);

export function emptyDraft(ledger: Ledger, today = dateKey(), kind: Kind = "expense"): ScheduleDraft {
  return {
    kind,
    title: "",
    amount: "",
    date: today,
    frequency: "monthly",
    categoryId: ledger.categories.find((category) => category.kind === kind)?.id ?? "",
    accountId: "",
    note: "",
    split: "full",
    shareInput: "",
  };
}

export function draftFromRule(rule: Recurring): ScheduleDraft {
  return {
    kind: rule.kind,
    title: rule.title,
    amount: toInput(rule.total),
    date: rule.nextDate,
    frequency: rule.frequency,
    categoryId: rule.categoryId,
    accountId: rule.accountId ?? "",
    note: rule.note,
    split: rule.kind === "expense" && rule.share !== rule.total ? "amount" : "full",
    shareInput: rule.kind === "expense" && rule.share !== rule.total ? toInput(rule.share) : "",
  };
}

interface Built {
  total: number;
  share: number;
  title: string;
  note: string;
}

/**
 * Checks a draft against the ledger it will be saved to. Returns per-field messages, or the
 * amounts and trimmed text. `editing` is the rule being edited: its next date must be today or
 * later, so editing never re-records past dates; a new schedule may start in the past and records
 * the dates it missed when it is saved.
 */
export function checkDraft(draft: ScheduleDraft, ledger: Ledger, today = dateKey(), editing?: Recurring): { errors: DraftErrors; built?: Built } {
  const errors: DraftErrors = {};
  const title = draft.title.trim();
  if (!title) errors.title = "Add a name for this schedule.";
  else if (title.length > MAX_TITLE) errors.title = `Use up to ${String(MAX_TITLE)} characters for the name.`;
  let total: number | null = null;
  try {
    total = cents(draft.amount);
    if (!total) errors.amount = "Enter an amount greater than zero.";
  } catch (error) {
    errors.amount = error instanceof Error ? error.message : "Enter an amount.";
  }
  if (!validDate(draft.date)) errors.date = "Choose a valid date between 2000 and 2100.";
  else if (editing && draft.date < today && draft.date !== editing.nextDate) errors.date = "Choose today or a later date. Past entries aren't recorded again.";
  if (!ledger.categories.some((category) => category.id === draft.categoryId && category.kind === draft.kind)) errors.categoryId = "Choose a category.";
  if (draft.accountId && !ledger.accounts.some((account) => account.id === draft.accountId)) errors.accountId = "This account was removed on another device. Choose another account.";
  const note = draft.note.trim();
  if (note.length > MAX_NOTE) errors.note = `Use up to ${String(MAX_NOTE)} characters for the note.`;
  let share = total ?? 0;
  if (total && !errors.amount && draft.kind === "expense" && draft.split !== "full") {
    try {
      share = personalShare(total, draft.split, draft.shareInput);
    } catch (error) {
      errors.share = error instanceof Error ? error.message : "Enter your share.";
    }
  }
  if (!editing && ledger.recurring.length >= MAX_SCHEDULES) errors.title = `You can have up to ${String(MAX_SCHEDULES)} schedules. Remove one first.`;
  if (Object.keys(errors).length || total === null) return { errors };
  return { errors, built: { total, share, title, note } };
}

/** A new rule from a checked draft: anchored on the first date's day, starting on that date. */
export function newRule(draft: ScheduleDraft, built: Built, id = uid()): Recurring {
  return {
    id,
    title: built.title,
    kind: draft.kind,
    total: built.total,
    share: built.share,
    categoryId: draft.categoryId,
    ...(draft.accountId ? { accountId: draft.accountId } : {}),
    date: draft.date,
    note: built.note,
    frequency: draft.frequency,
    nextDate: draft.date,
    anchorDay: parseDate(draft.date).getDate(),
    active: true,
  };
}

/**
 * The edited rule (the legacy and native `buildSchedule`): the first date never changes, moving the
 * next date re-anchors on the new day, keeping it keeps the anchor (a rule on the 31st stays on the
 * 31st after February). Clearing the account removes it. Recorded occurrences are not touched.
 */
export function editedRule(original: Recurring, draft: ScheduleDraft, built: Built): Recurring {
  const rest: Recurring = { ...original };
  delete rest.accountId;
  return {
    ...rest,
    title: built.title,
    kind: draft.kind,
    total: built.total,
    share: built.share,
    categoryId: draft.categoryId,
    ...(draft.accountId ? { accountId: draft.accountId } : {}),
    note: built.note,
    frequency: draft.frequency,
    nextDate: draft.date,
    // Keep the anchor only when neither the date nor the cadence changed: a weekly rule moved to monthly
    // on Nov 17 repeats on the 17th, not on the day the weekly rule started.
    anchorDay: draft.date === original.nextDate && draft.frequency === original.frequency ? original.anchorDay : parseDate(draft.date).getDate(),
  };
}

/**
 * Adds a schedule. The engine materializes after every save, so dates from the first date through
 * today are recorded at once with occurrence ids `{ruleId}:{date}`, and later ones on their day.
 * Checked again against the ledger it lands on, which may have changed on another device.
 */
export function addSchedule(rule: Recurring): LedgerChange {
  return (ledger) => {
    if (rule.accountId !== undefined && !ledger.accounts.some((account) => account.id === rule.accountId))
      throw new Error("This payment account was removed on another device. Choose another account.");
    if (!ledger.categories.some((category) => category.id === rule.categoryId && category.kind === rule.kind))
      throw new Error("This category was removed on another device. Choose another category.");
    if (ledger.recurring.length >= MAX_SCHEDULES) throw new Error(`You can have up to ${String(MAX_SCHEDULES)} schedules. Remove one first.`);
    if (ledger.recurring.some((item) => item.id === rule.id)) return ledger;
    return { ...ledger, recurring: [...ledger.recurring, rule] };
  };
}

export const categoryOf = (ledger: Ledger, id: string): Category | undefined => ledger.categories.find((category) => category.id === id);
export const accountOf = (ledger: Ledger, id: string | undefined): PaymentAccount | undefined => (id ? ledger.accounts.find((account) => account.id === id) : undefined);
