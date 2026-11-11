import type { AuditEvent, Household, HouseholdDetail, HouseholdMember, SharedExpense } from "../../api/schemas";

/**
 * Display helpers for the shared screens. The server owns every shared rule (splits, balances,
 * suggestions, eligibility, settlement): these only preview what the form will send and label
 * what the server returned. The split preview mirrors `HouseholdSplits` and is checked against
 * the golden `contracts/fixtures/shared-splits.json` cases, so the preview never disagrees with
 * the server on rounding.
 */

export const MAX_CENTS = 99_999_999_999;

/** Client amount parsing, as `contracts/fixtures/money.json` `parse`: up to two decimals, comma or dot. */
export function parseAmount(input: string): number | null {
  const value = input.trim().replace(",", ".");
  const match = /^(\d{1,9})(?:\.(\d{0,2}))?$/.exec(value);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  return whole * 100 + fraction;
}

/** A percentage with up to two decimals ("33.33") as basis points (3333), or null. */
export function parsePercent(input: string): number | null {
  const value = input.trim().replace(",", ".").replace(/%$/, "").trim();
  const match = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(value);
  if (!match) return null;
  const points = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return points <= 10_000 ? points : null;
}

export const centsToInput = (cents: number) => (cents / 100).toFixed(2);
export const pointsToInput = (points: number) => (points / 100).toFixed(points % 100 === 0 ? 0 : 2);

const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Equal split: members by id, the remainder one cent each to the first ids (server `HouseholdSplits`). */
export function equalSplit(totalCents: number, memberIds: readonly string[]): { userId: string; amountCents: number }[] {
  const ids = [...new Set(memberIds)].sort(ordinal);
  if (!ids.length) return [];
  const each = Math.floor(totalCents / ids.length);
  const remainder = totalCents % ids.length;
  return ids.map((userId, index) => ({ userId, amountCents: each + (index < remainder ? 1 : 0) }));
}

/** Percentage split in basis points: floor shares, leftover cents to the largest remainders, ties to the lower id. */
export function percentSplit(totalCents: number, allocations: readonly { userId: string; percentBasisPoints: number }[]) {
  const sorted = [...allocations].sort((a, b) => ordinal(a.userId, b.userId));
  const quotient = Math.floor(totalCents / 10_000);
  const remainder = totalCents % 10_000;
  const weighted = sorted.map(({ userId, percentBasisPoints }) => {
    const minor = remainder * percentBasisPoints;
    return { userId, amountCents: quotient * percentBasisPoints + Math.floor(minor / 10_000), leftover: minor % 10_000 };
  });
  let left = totalCents - weighted.reduce((sum, item) => sum + item.amountCents, 0);
  for (const item of [...weighted].sort((a, b) => b.leftover - a.leftover || ordinal(a.userId, b.userId))) {
    if (left <= 0) break;
    item.amountCents += 1;
    left -= 1;
  }
  return weighted.map(({ userId, amountCents }) => ({ userId, amountCents }));
}

/* ---------- months and dates ---------- */

const pad = (value: number) => String(value).padStart(2, "0");

/** Today on the user's own calendar. Shared expense dates are local calendar days. */
export function localDate(now = new Date()): string {
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const currentMonth = (now = new Date()) => localDate(now).slice(0, 7);

export function shiftMonth(month: string, delta: number): string {
  const [year = 2000, number = 1] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + delta, 1));
  return `${String(date.getUTCFullYear())}-${pad(date.getUTCMonth() + 1)}`;
}

export function monthLabel(month: string, style: "long" | "short" = "long"): string {
  const [year = 2000, number = 1] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1, 1)).toLocaleDateString("en-CA", { month: style, year: "numeric", timeZone: "UTC" });
}

export function dayLabel(date: string, withYear = false): string {
  const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

/** The month's last calendar day, from which (UTC) the server accepts monthly payments. */
export function monthEnd(month: string): string {
  const [year = 2000, number = 1] = month.split("-").map(Number);
  return `${month}-${pad(new Date(Date.UTC(year, number, 0)).getUTCDate())}`;
}

/** Mirrors the server's UTC month-end cutoff, only to explain the wait. The server still decides. */
export function monthlyPaymentsOpen(month: string, now = new Date()): boolean {
  return now.toISOString().slice(0, 10) >= monthEnd(month);
}

const utcDay = (instant: number) => new Date(instant).toISOString().slice(0, 10);

/* ---------- members ---------- */

export const isCurrent = (member: HouseholdMember) => member.leftAt === undefined || member.leftAt === null;

/** The caller's own membership: `/me` only knows the email, members carry ids. */
export function findMe(members: readonly HouseholdMember[], email: string): HouseholdMember | undefined {
  const lower = email.toLowerCase();
  return members.find((member) => member.email.toLowerCase() === lower);
}

/**
 * Who an expense on `date` is split among, to preview the split. Households use the members
 * active that day (local join day up to the UTC day they left); shared trips use every current
 * member. The server applies the same rule and rejects a split that doesn't match it.
 */
export function eligibleMembers(detail: HouseholdDetail, date: string): HouseholdMember[] {
  if (detail.household.trip) return detail.members.filter(isCurrent);
  return detail.members.filter((member) => {
    const joined = member.joinedOn ?? localDate(new Date(member.joinedAt));
    const left = isCurrent(member) ? undefined : utcDay(member.leftAt ?? 0);
    return joined <= date && (left === undefined || date < left);
  });
}

export interface People {
  meId: string | undefined;
  /** "You", the member's email, or "Former member" for someone the caller can't see. */
  name: (userId: string) => string;
  isCurrentMember: (userId: string) => boolean;
}

export function people(detail: HouseholdDetail | undefined, email: string): People {
  const members = detail?.members ?? [];
  const me = findMe(members, email);
  const meId = me?.userId;
  return {
    meId,
    name: (userId) => (userId === meId ? "You" : (members.find((member) => member.userId === userId)?.email ?? "Former member")),
    isCurrentMember: (userId) => members.some((member) => member.userId === userId && isCurrent(member)),
  };
}

/** "your" for the viewer, otherwise "bea@example.test's". */
export const possessive = (name: string) => (name === "You" ? "your" : `${name}'s`);

export const isCreator = (household: Household, meId: string | undefined) => meId !== undefined && household.creatorId === meId;

/* ---------- expenses ---------- */

export const shareOf = (expense: SharedExpense, userId: string | undefined) =>
  userId === undefined ? 0 : (expense.splits.find((split) => split.userId === userId)?.amountCents ?? 0);

export const sharePaid = (expense: SharedExpense, userId: string) => expense.payments.some((payment) => payment.fromUserId === userId);

export type ShareStatus = "payer" | "none" | "paid" | "monthly" | "unpaid";

export function shareStatus(expense: SharedExpense, userId: string, amountCents: number): ShareStatus {
  if (userId === expense.payerUserId) return "payer";
  if (amountCents <= 0) return "none";
  if (sharePaid(expense, userId)) return "paid";
  if (expense.paymentsClosed) return "monthly";
  return "unpaid";
}

export const SHARE_STATUS_LABEL: Record<ShareStatus, string> = {
  payer: "Paid the expense",
  none: "Nothing to repay",
  paid: "Repaid",
  monthly: "Settles with the month",
  unpaid: "Not repaid yet",
};

/**
 * Whether the caller may record `fromUserId`'s share of this expense as paid: the debtor or the
 * payer, both still members, a positive unpaid share, and the month not settled monthly yet.
 */
export function canRecordShare(expense: SharedExpense, fromUserId: string, who: People, archived: boolean): boolean {
  const { meId } = who;
  if (archived || !meId || !who.isCurrentMember(meId)) return false;
  if (fromUserId === expense.payerUserId || expense.paymentsClosed || sharePaid(expense, fromUserId)) return false;
  if (!who.isCurrentMember(fromUserId) || !who.isCurrentMember(expense.payerUserId)) return false;
  if (meId !== fromUserId && meId !== expense.payerUserId) return false;
  return shareOf(expense, fromUserId) > 0;
}

export function splitLabel(expense: Pick<SharedExpense, "splitMode">): string {
  return expense.splitMode === "equal" ? "Equally" : expense.splitMode === "exact" ? "By amount" : "By percent";
}

/** Payments affect balances, so an expense with one can't change payer, total, month or shares. */
export const isPaid = (expense: SharedExpense) => expense.payments.length > 0;

/* ---------- audit ---------- */

export type AuditFilter = "all" | "expenses" | "payments" | "members";

export function auditCategory(action: string): Exclude<AuditFilter, "all"> | "household" {
  if (action.startsWith("expense.") || action.startsWith("recurring.")) return "expenses";
  if (action.startsWith("reimbursement.")) return "payments";
  if (action.startsWith("member.") || action.startsWith("invite.")) return "members";
  return "household";
}

const text = (value: unknown, fallback: string): string => (typeof value === "string" && value ? value : fallback);
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

const LABELS: Record<string, string> = {
  name: "Name",
  title: "Title",
  totalCents: "Total",
  date: "Date",
  payerUserId: "Paid by",
  splitMode: "Split",
  category: "Category",
  note: "Note",
  splits: "Shares",
  receiptId: "Receipt",
  frequency: "Repeats",
  nextDate: "Next date",
  active: "Status",
};

/**
 * One readable sentence per audit event and the fields it changed. Snapshots arrive redacted
 * (no payer account, no receipt name), and nothing here ever reads an account.
 */
export function describeAudit(event: AuditEvent, name: (userId: string) => string, money: (cents: number) => string) {
  const before = record(event.before);
  const after = record(event.after);
  const actor = name(event.actorId);
  const subject = text(after.title, text(before.title, "an expense"));
  const format = (key: string, value: unknown): string => {
    if (value === undefined || value === null || value === "") return "none";
    if (key === "totalCents" && typeof value === "number") return money(value);
    if (key === "payerUserId" && typeof value === "string") return name(value);
    if (key === "category") return text(record(value).name, "Other");
    if (key === "splitMode") return value === "equal" ? "equally" : value === "exact" ? "by amount" : "by percent";
    if (key === "splits" && Array.isArray(value)) {
      return value.map((part) => `${name(text(record(part).userId, ""))} ${money(Number(record(part).amountCents))}`).join(", ");
    }
    if (key === "receiptId") return "attached";
    if (key === "active") return value === false ? "paused" : "active";
    return typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(value);
  };
  let summary: string;
  switch (event.action) {
    case "household.created":
    case "trip.created":
      summary = `${actor} created ${text(after.name, "the household")}`;
      break;
    case "household.renamed":
    case "trip.edited":
      summary = `${actor} renamed the household`;
      break;
    case "invite.created":
      summary = `${actor} created an invite code`;
      break;
    case "member.joined":
      summary = `${name(text(after.userId, event.actorId))} joined`;
      break;
    case "member.left":
      summary = `${name(text(before.userId, event.actorId))} left`;
      break;
    case "member.removed":
      summary = `${actor} removed ${name(text(before.userId, ""))}`;
      break;
    case "household.archived":
      summary = `${actor} archived the household`;
      break;
    case "expense.created":
      summary = after.recurringId ? `${subject} was added automatically` : `${actor} added ${subject}`;
      break;
    case "expense.updated":
      summary = `${actor} edited ${subject}`;
      break;
    case "expense.deleted":
      summary = `${actor} deleted ${subject}`;
      break;
    case "expense.moved":
      summary = `${actor} moved ${subject} to another household`;
      break;
    case "reimbursement.created": {
      const amount = typeof after.amountCents === "number" ? money(after.amountCents) : "a payment";
      const from = name(text(after.fromUserId, ""));
      const to = name(text(after.toUserId, ""));
      summary = after.expenseId ? `${actor} recorded ${possessive(from)} ${amount} share payment to ${to}` : `${actor} recorded ${from} paid ${to} ${amount}`;
      break;
    }
    case "recurring.created":
      summary = `${actor} set up ${subject} to repeat`;
      break;
    case "recurring.updated":
      summary = `${actor} changed repeating ${subject}`;
      break;
    case "recurring.deleted":
      summary = `${actor} stopped repeating ${subject}`;
      break;
    default:
      summary = `${actor}: ${event.action}`;
  }
  const changes =
    event.action === "expense.updated" || event.action === "recurring.updated" || event.action === "household.renamed" || event.action === "trip.edited"
      ? Object.keys(LABELS)
          .filter((key) => key in before && key in after && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
          .map((key) => `${LABELS[key] ?? key}: ${format(key, before[key])} → ${format(key, after[key])}`)
      : event.action === "expense.created" && typeof after.totalCents === "number"
        ? [`${money(after.totalCents)} · split ${format("splitMode", after.splitMode)}`]
        : [];
  return { summary, changes };
}

