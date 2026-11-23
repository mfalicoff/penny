import { createFileRoute, redirect } from "@tanstack/react-router";
import { fragmentCode, keepResetCode } from "../auth/fragmentCodes";
import { ResetPasswordPage } from "../features/auth/PasswordReset";

/**
 * Set a new password with a reset code (MAZ-123, MAZ-124). The emailed link carries the code in
 * the fragment (`#code=`): it is kept in memory and the address is replaced without it, so the
 * code doesn't linger in the address bar or the history. Reachable while signed out.
 */
export const Route = createFileRoute("/reset-password")({
  staticData: { title: "Set a new password" },
  beforeLoad: ({ location }) => {
    const code = fragmentCode(location.hash);
    if (code === null) return;
    keepResetCode(code);
    throw redirect({ to: "/reset-password", replace: true });
  },
  component: ResetPasswordPage,
});
