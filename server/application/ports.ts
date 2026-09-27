import type { Ledger } from "../../src/domain/ledger.ts";

export type User = { id: string; email: string; password: string; salt: string };
export type LedgerSnapshot = { revision: number; ledger: Ledger };
export type StoredReceipt = { name: string; mime: string; data: Uint8Array };
export type Session = { userId: string; tokenHash: string };

export interface AccountRepository {
  findByEmail(email: string): User | undefined;
  findEmail(userId: string): { email: string } | undefined;
  /** Creates the user and initial ledger in one transaction; false on duplicate email. */
  create(user: User, ledger: Ledger): boolean;
}

export interface SessionRepository {
  create(tokenHash: string, userId: string, expires: number, now: number): void;
  findUser(tokenHash: string, now: number): string | undefined;
  remove(tokenHash: string): void;
}

export interface LedgerRepository {
  read(userId: string): LedgerSnapshot;
  /** Atomic compare-and-swap; false if another writer changed the revision. */
  save(userId: string, snapshot: LedgerSnapshot): boolean;
}

export interface ReceiptRepository {
  owns(userId: string, receiptId: string): boolean;
  create(userId: string, receiptId: string, receipt: StoredReceipt): void;
  read(userId: string, receiptId: string): StoredReceipt | undefined;
}

export interface Security {
  randomId(bytes: number): string;
  hashToken(token: string): string;
  hashPassword(password: string, salt: string): Promise<string>;
  verifyPassword(password: string, salt: string, expected: string): Promise<boolean>;
}
