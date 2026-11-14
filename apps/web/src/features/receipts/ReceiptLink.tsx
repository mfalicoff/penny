import type { Receipt } from "@domain/ledger.ts";
import { useState } from "react";
import { isServedReceipt } from "../../api/receipts";
import { Button } from "../../design/controls";
import { ReceiptPreviewDialog } from "./ReceiptPreviewDialog";

/**
 * A receipt in an entry or expense detail (MAZ-94): its name, opening the in-app preview with the
 * session. A receipt this server doesn't serve (a path on another device) is shown as text only.
 */
export function ReceiptLink({ receipt }: { receipt: Receipt }) {
  const [open, setOpen] = useState(false);
  const name = receipt.name || "Receipt";
  if (!isServedReceipt(receipt)) return <>{name}</>;
  return (
    <>
      <Button
        variant="quiet"
        icon={receipt.mime === "application/pdf" ? "document-text" : "image"}
        className="receipt-link"
        aria-label={`Open receipt ${name}`}
        onClick={() => {
          setOpen(true);
        }}
      >
        {name}
      </Button>
      {open ? (
        <ReceiptPreviewDialog
          receipt={receipt}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
