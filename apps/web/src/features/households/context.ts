import type { HouseholdDetail } from "../../api/schemas";
import { formatCents } from "../../design/Money";
import { isCreator, type People } from "./model";

/**
 * Which URL family the page lives under: `/households/$id`, or a shared trip's `/trips/$id`
 * (MAZ-93). The tabs build their links and where to go after leaving from it.
 */
export type HouseholdRoute = "households" | "trips";

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
  route: HouseholdRoute;
}

export function householdView(
  householdId: string,
  detail: HouseholdDetail,
  who: People,
  month: string,
  archived: boolean,
  route: HouseholdRoute = "households",
): HouseholdView {
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
    route,
  };
}
