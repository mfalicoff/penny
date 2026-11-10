import { createFileRoute } from "@tanstack/react-router";
import { CallbackPage } from "../features/auth/CallbackPage";

/** Legacy URL kept from the Expo app: the OIDC provider's redirect target. It must stay reachable while signed out. */
export const Route = createFileRoute("/auth/callback")({
  component: CallbackPage,
});
