import type { HouseholdDetail } from "../../api/schemas";
import { formatCents } from "../../design/Money";
import { isCreator, type People } from "./model";

/** What every part of the household page needs to know about the household and the viewer. */
export interface HouseholdView {
  householdId: string;
  detail: HouseholdDetail;
  who: People;
  /** The viewer is a current member of a household that isn't archived, so they can make changes. */
  canWrite: boolean;
  archived: boolean;
  creator: boolean;
  month: string;
  currency: string;
  money: (cents: number) => string;
}

export function householdView(householdId: string, detail: HouseholdDetail, who: People, month: string, archived: boolean): HouseholdView {
  const current = who.meId !== undefined && who.isCurrentMember(who.meId);
  return {
    householdId,
    detail,
    who,
    canWrite: current && !archived,
    archived,
    creator: isCreator(detail.household, who.meId),
    month,
    currency: detail.household.currency,
    money: (cents) => formatCents(cents, detail.household.currency),
  };
}
