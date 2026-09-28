import { decodeReceipt, receiptUploadSchema } from "../validation/receipts.ts";
import { ApplicationError } from "./errors.ts";
import type { ReceiptRepository, Security } from "./ports.ts";

export function createReceiptService(receipts: ReceiptRepository, security: Pick<Security, "randomId">, canReadShared?: (userId: string, receiptId: string) => boolean) {
  return {
    upload(userId: string, body: unknown) {
      const input = receiptUploadSchema.safeParse(body);
      if (!input.success) throw new ApplicationError("invalid", "Choose a photo or PDF smaller than 10 MB.");
      const bytes = decodeReceipt(input.data);
      if (!bytes) throw new ApplicationError("invalid", "This file is not a supported photo or PDF, or exceeds 10 MB.");
      const id = security.randomId(16);
      const { name, mime } = input.data;
      receipts.create(userId, id, { name, mime, data: bytes });
      return { id, name, mime };
    },
    read(userId: string, receiptId: string) {
      const receipt = receipts.read(userId, receiptId) ?? (canReadShared?.(userId, receiptId) ? receipts.readShared?.(receiptId) : undefined);
      if (!receipt) throw new ApplicationError("not_found", "Receipt not found.");
      return receipt;
    },
  };
}

export type ReceiptService = ReturnType<typeof createReceiptService>;
