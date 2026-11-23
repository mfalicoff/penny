import { useSyncExternalStore } from "react";
import { clearJoinCode, peekJoinCode, subscribeJoinCode } from "../../auth/fragmentCodes";
import { useIsDemo } from "../../demo/demo";
import { JoinHouseholdDialog } from "./StartDialogs";

/**
 * The join dialog for an emailed invitation (MAZ-124): `/join#code=` keeps the code in this tab
 * and this opens Join a household with it filled in, on whatever page the person lands after
 * signing in. They still choose Join household, so joining stays their decision. Closing the
 * dialog or joining forgets the code.
 */
export function PendingJoin() {
  const code = useSyncExternalStore(subscribeJoinCode, peekJoinCode, () => null);
  const demo = useIsDemo();
  if (!code || demo) return null;
  return <JoinHouseholdDialog initialCode={code} onClose={clearJoinCode} />;
}
