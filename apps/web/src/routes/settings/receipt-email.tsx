import { createFileRoute } from "@tanstack/react-router";
import { ReceiptEmailSettings } from "../../features/receiptInbox/ReceiptEmailSettings";

/** Settings › Receipt email (MAZ-184). Listed only when the server accepts emailed receipts. */
export const Route = createFileRoute("/settings/receipt-email")({
  staticData: { title: "Receipt email", back: "/settings", backLabel: "All settings" },
  component: ReceiptEmailSettings,
});
