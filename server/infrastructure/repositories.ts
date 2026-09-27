import type { DatabaseSync } from "node:sqlite";
import type { AccountRepository, LedgerRepository, ReceiptRepository, SessionRepository, StoredReceipt, User } from "../application/ports.ts";
import type { Ledger } from "../../src/domain/ledger.ts";

export function createRepositories(db: DatabaseSync) {
  const accounts: AccountRepository = {
    findByEmail(email) {
      return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as User | undefined;
    },
    findEmail(userId) {
      return db.prepare("SELECT email FROM users WHERE id = ?").get(userId) as { email: string } | undefined;
    },
    create(user, ledger) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = db.prepare("INSERT INTO users VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING")
          .run(user.id, user.email, user.password, user.salt);
        if (!result.changes) {
          db.exec("ROLLBACK");
          return false;
        }
        db.prepare("INSERT INTO ledgers VALUES (?, 0, ?)").run(user.id, JSON.stringify(ledger));
        db.exec("COMMIT");
        return true;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const sessions: SessionRepository = {
    create(tokenHash, userId, expires, now) {
      db.prepare("DELETE FROM sessions WHERE expires < ?").run(now);
      db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(tokenHash, userId, expires);
    },
    findUser(tokenHash, now) {
      const row = db.prepare("SELECT user_id FROM sessions WHERE token_hash = ? AND expires > ?").get(tokenHash, now);
      return row?.user_id as string | undefined;
    },
    remove(tokenHash) {
      db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    },
  };
  const ledgers: LedgerRepository = {
    read(userId) {
      const row = db.prepare("SELECT revision, data FROM ledgers WHERE user_id = ?").get(userId);
      if (!row) throw new Error("Account ledger is missing.");
      return { revision: row.revision as number, ledger: JSON.parse(row.data as string) as Ledger };
    },
    save(userId, snapshot) {
      const result = db.prepare("UPDATE ledgers SET data = ?, revision = revision + 1 WHERE user_id = ? AND revision = ?")
        .run(JSON.stringify(snapshot.ledger), userId, snapshot.revision);
      return result.changes !== 0;
    },
  };
  const receipts: ReceiptRepository = {
    owns(userId, receiptId) {
      return !!db.prepare("SELECT id FROM receipts WHERE id = ? AND user_id = ?").get(receiptId, userId);
    },
    create(userId, receiptId, receipt) {
      db.prepare("INSERT INTO receipts VALUES (?, ?, ?, ?, ?)")
        .run(receiptId, userId, receipt.name, receipt.mime, receipt.data);
    },
    read(userId, receiptId) {
      return db.prepare("SELECT name, mime, data FROM receipts WHERE id = ? AND user_id = ?")
        .get(receiptId, userId) as StoredReceipt | undefined;
    },
  };
  return { accounts, sessions, ledgers, receipts };
}
