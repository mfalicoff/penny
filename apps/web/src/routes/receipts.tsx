import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { InboxPage } from "../features/receiptInbox/InboxPage";

/**
 * Receipts to attach (MAZ-184): the emailed-receipt inbox. `status` is the filter (To attach or
 * Attached) and `item` opens one email, as a notification link does. Bad values fall back.
 */
export const receiptsSearchSchema = z.object({
  status: z.enum(["to_attach", "attached"]).catch("to_attach").default("to_attach"),
  item: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute("/receipts")({
  staticData: { title: "Receipts to attach" },
  validateSearch: receiptsSearchSchema,
  component: Receipts,
});

function Receipts() {
  const search = Route.useSearch();
  return <InboxPage search={search} />;
}
