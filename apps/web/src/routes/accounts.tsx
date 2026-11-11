import { createFileRoute } from "@tanstack/react-router";
import { AccountsPage } from "../features/organize/AccountsPage";

/** Payment accounts (MAZ-89), at the legacy URL kept from the Expo app. */
export const Route = createFileRoute("/accounts")({
  staticData: { title: "Accounts" },
  component: AccountsPage,
});
