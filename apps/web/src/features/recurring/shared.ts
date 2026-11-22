import { useQueries, useQuery } from "@tanstack/react-query";
import { householdDetailQuery, householdsQuery, recurringQuery } from "../../api/households";
import type { Household, HouseholdDetail, SharedRecurring } from "../../api/schemas";
import { eligibleMembers, equalSplit, findMe, percentSplit } from "../households/model";

/**
 * Shared schedules on Recurring (MAZ-177): the repeating expenses of every household and shared
 * trip the account belongs to, where the account is part of the split, with the account's share of
 * the next occurrence. Shared data is online-only and optional context here: a household that
 * fails to load (or offline with nothing cached) leaves the personal list alone.
 */
export interface SharedSchedule {
  rule: SharedRecurring;
  household: Household;
  /** The account's share of the next occurrence, in the household's currency. */
  shareCents: number;
}

/**
 * The account's share of a rule's next occurrence, or `undefined` when the account isn't in its
 * split. Follows the server's recurring split (`ExpenseSplit.Recurring`, and the shared domain's
 * `calculateRecurringSplits`): the stored split while exactly the same members are active on that
 * date, otherwise an equal split among them; an equal split too when the stored split no longer
 * adds up.
 */
export function shareOfRule(rule: SharedRecurring, detail: HouseholdDetail, meId: string): number | undefined {
  const activeIds = [...new Set(eligibleMembers(detail, rule.nextDate).map((member) => member.userId))];
  if (!activeIds.includes(meId)) return undefined;
  return storedSplit(rule, activeIds)?.find((split) => split.userId === meId)?.amountCents ?? equalSplit(rule.totalCents, activeIds).find((split) => split.userId === meId)?.amountCents;
}

/** The rule's own exact or percentage split, when it still applies to `activeIds`. */
function storedSplit(rule: SharedRecurring, activeIds: readonly string[]): { userId: string; amountCents: number }[] | undefined {
  if (rule.splitMode === "equal") return undefined;
  const allocations = rule.allocations ?? [];
  const ids = new Set(allocations.map((item) => item.userId));
  if (ids.size !== allocations.length || ids.size !== activeIds.length || !activeIds.every((id) => ids.has(id))) return undefined;
  if (rule.splitMode === "exact") {
    const amounts = allocations.map((item) => ({ userId: item.userId, amountCents: "amountCents" in item ? item.amountCents : -1 }));
    const valid = amounts.every((item) => item.amountCents >= 0) && amounts.reduce((sum, item) => sum + item.amountCents, 0) === rule.totalCents;
    return valid ? amounts : undefined;
  }
  const points = allocations.map((item) => ({ userId: item.userId, percentBasisPoints: "percentBasisPoints" in item ? item.percentBasisPoints : -1 }));
  const valid = points.every((item) => item.percentBasisPoints >= 0) && points.reduce((sum, item) => sum + item.percentBasisPoints, 0) === 10_000;
  return valid ? percentSplit(rule.totalCents, points) : undefined;
}

/** The shared schedules the account is part of, from loaded households. Missing data is skipped. */
export function sharedSchedules(
  households: readonly Household[],
  details: readonly (HouseholdDetail | undefined)[],
  rules: readonly (readonly SharedRecurring[] | undefined)[],
  email: string,
): SharedSchedule[] {
  const list: SharedSchedule[] = [];
  households.forEach((household, index) => {
    const detail = details[index];
    const meId = detail ? findMe(detail.members, email)?.userId : undefined;
    if (!detail || !meId) return;
    for (const rule of rules[index] ?? []) {
      const shareCents = shareOfRule(rule, detail, meId);
      if (shareCents !== undefined) list.push({ rule, household, shareCents });
    }
  });
  return list;
}

/** Loads the account's households, their members and their rules (the demo's household has none). */
export function useSharedSchedules(email: string): SharedSchedule[] {
  const households = useQuery(householdsQuery(email));
  const list = households.data ?? [];
  const details = useQueries({ queries: list.map((household) => householdDetailQuery(email, household.id)) });
  const rules = useQueries({ queries: list.map((household) => recurringQuery(email, household.id)) });
  return sharedSchedules(
    list,
    details.map((query) => query.data),
    rules.map((query) => query.data),
    email,
  );
}
