import { createFileRoute, redirect } from "@tanstack/react-router";
import { fragmentCode, keepVerifyCode } from "../auth/fragmentCodes";
import { VerifyEmailPage } from "../features/auth/EmailVerification";

/**
 * Email verification (MAZ-172): "Check your email" after creating an account, and the emailed
 * link's landing page. The link carries the code in the fragment (`#code=`): it is kept in memory
 * and the address is replaced without it. Reachable while signed out, so the link works on any device.
 */
export const Route = createFileRoute("/verify-email")({
  staticData: { title: "Verify your email" },
  beforeLoad: ({ location }) => {
    const code = fragmentCode(location.hash);
    if (code === null) return;
    keepVerifyCode(code);
    throw redirect({ to: "/verify-email", replace: true });
  },
  component: VerifyEmailPage,
});
