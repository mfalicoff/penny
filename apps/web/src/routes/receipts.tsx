import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { InboxPage } from "../features/receiptInbox/InboxPage";

/**
 * The Inbox (MAZ-184, MAZ-291): captured purchases and emailed receipts waiting to be handled.
 * `status` is the filter (To review or Done; the older To attach and Attached links still open
 * them) and `item` opens one email, as a notification link does. Bad values fall back.
 */
export const receiptsSearchSchema = z.object({
  status: z
    .preprocess((value) => (value === "to_attach" ? "to_review" : value === "attached" ? "done" : value), z.enum(["to_review", "done"]))
    .catch("to_review")
    .default("to_review"),
  item: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute("/receipts")({
  staticData: { title: "Inbox" },
  validateSearch: receiptsSearchSchema,
  component: Receipts,
});

function Receipts() {
  const search = Route.useSearch();
  return <InboxPage search={search} />;
}
