import { createFileRoute } from "@tanstack/react-router";
import { ForgotPasswordPage } from "../features/auth/PasswordReset";

/** Ask for a password reset email (MAZ-124). Reachable while signed out, like the OIDC callback. */
export const Route = createFileRoute("/forgot-password")({
  staticData: { title: "Reset your password" },
  component: ForgotPasswordPage,
});
