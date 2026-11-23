import { createFileRoute, redirect } from "@tanstack/react-router";
import { fragmentCode, keepJoinCode } from "../auth/fragmentCodes";

/**
 * The invitation email's link, `/join#code=<invite code>` (MAZ-124). The code waits in this tab
 * (never in the address) and the join dialog opens with it on Shared, after sign-in if needed.
 * Joining still asks the person to accept.
 */
export const Route = createFileRoute("/join")({
  staticData: { title: "Join" },
  beforeLoad: ({ location }) => {
    keepJoinCode(fragmentCode(location.hash));
    throw redirect({ to: "/households", replace: true });
  },
});
