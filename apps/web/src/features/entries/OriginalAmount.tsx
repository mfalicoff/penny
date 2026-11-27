import type { Transaction } from "@domain/ledger.ts";
import { foreignOf, formatMinor } from "./currency";

/**
 * Under a list row's home amount (`web-activity-currencies`, `iphone-home-currencies`): the amount
 * the entry was paid in ("€85.00", "US$34.99" beside a CAD home), and for a provisional rate
 * "≈ €48.00 · provisional" in amber, with the word, so the meaning isn't color alone. `marker:
 * false` leaves the provisional word to the row's meta (Home's Recent: "provisional rate").
 */
export function OriginalAmount({ entry, home, marker = true }: { entry: Pick<Transaction, "originalAmount" | "originalCurrency" | "rate" | "rateStatus" | "rateDate">; home: string | undefined; marker?: boolean }) {
  const foreign = foreignOf(entry);
  if (!foreign) return null;
  const provisional = marker && foreign.status === "provisional";
  return (
    <span className="results__sub results__original pk-num">
      <span className="visually-hidden">Paid </span>
      {provisional ? (
        <>
          <span className="results__provisional" aria-hidden="true">
            ≈
          </span>{" "}
        </>
      ) : null}
      {formatMinor(foreign.amount, foreign.currency, home)}
      {provisional ? (
        <>
          {" · "}
          <span className="results__provisional">provisional</span>
        </>
      ) : null}
    </span>
  );
}

/** Whether a list row should say "provisional rate" (Home's Recent meta). */
export const isProvisional = (entry: Pick<Transaction, "rateStatus" | "originalCurrency">) => entry.originalCurrency !== undefined && entry.rateStatus === "provisional";
