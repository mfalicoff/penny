import { ledgerWriteSchema } from "../validation/ledger.ts";
import { ApplicationError } from "./errors.ts";
import type { LedgerRepository, ReceiptRepository } from "./ports.ts";

export function createLedgerService(ledgers: LedgerRepository, receipts: Pick<ReceiptRepository, "owns">) {
  return {
    read(userId: string) {
      return ledgers.read(userId);
    },
    save(userId: string, body: unknown) {
      const input = ledgerWriteSchema.safeParse(body);
      if (!input.success) throw new ApplicationError("invalid", "Invalid ledger data.");
      // Older clients drop account fields when rebuilding entries. Do not let
      // their legacy snapshots silently erase payment accounts or their links.
      const sourceVersion = (body as { ledger: { version: number } }).ledger.version;
      if (sourceVersion < 3 && ledgers.read(userId).ledger.accounts.length)
        throw new ApplicationError("invalid", "Update or reload the app before saving payment accounts.");
      for (const transaction of input.data.ledger.transactions) {
        if (transaction.receipt && !receipts.owns(userId, transaction.receipt.id)) {
          throw new ApplicationError("invalid", "Receipt does not belong to this account.");
        }
      }
      if (!ledgers.save(userId, input.data)) {
        throw new ApplicationError("conflict", "Your data changed on another device. Please refresh and try again.");
      }
      return { revision: input.data.revision + 1, ledger: input.data.ledger };
    },
  };
}

export type LedgerService = ReturnType<typeof createLedgerService>;
