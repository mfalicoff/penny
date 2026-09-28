import type { DatabaseSync } from "node:sqlite";
import type { AccountRepository, LedgerRepository, ReceiptRepository, SessionRepository, StoredReceipt, User } from "../application/ports.ts";
import { upgradeLedger } from "../../src/domain/ledger.ts";

export function createRepositories(db: DatabaseSync) {
  const accounts: AccountRepository = {
    findByIdentity(issuer, subject) {
      return db.prepare("SELECT users.* FROM users JOIN oidc_identities ON users.id = oidc_identities.user_id WHERE issuer = ? AND subject = ?").get(issuer, subject) as User | undefined;
    },
    createOidc(user, identity, ledger) {
      db.exec("BEGIN IMMEDIATE");
      try {
        if (accounts.findByEmail(user.email) || accounts.findByIdentity(identity.issuer, identity.subject)) {
          db.exec("ROLLBACK");
          return false;
        }
        db.prepare("INSERT INTO users VALUES (?, ?, ?, ?)").run(user.id, user.email, user.password, user.salt);
        db.prepare("INSERT INTO ledgers VALUES (?, 0, ?)").run(user.id, JSON.stringify(ledger));
        db.prepare("INSERT INTO oidc_identities VALUES (?, ?, ?)").run(identity.issuer, identity.subject, user.id);
        db.exec("COMMIT");
        return true;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
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
      return { revision: row.revision as number, ledger: upgradeLedger(JSON.parse(row.data as string)) };
    },
    save(userId, snapshot) {
      const result = db.prepare("UPDATE ledgers SET data = ?, revision = revision + 1 WHERE user_id = ? AND revision = ?")
        .run(JSON.stringify(snapshot.ledger), userId, snapshot.revision);
      return result.changes !== 0;
    },
    householdCurrencies(userId) {
      return (db.prepare("SELECT DISTINCT h.currency FROM households h JOIN household_members m ON m.household_id=h.id WHERE m.user_id=? AND m.left_at IS NULL AND h.archived_at IS NULL").all(userId) as {currency:string}[]).map((row)=>row.currency);
    },
    linkedHouseholdAccounts(userId) {
      return (db.prepare("SELECT DISTINCT account_id FROM household_expenses WHERE payer_id=? AND account_id IS NOT NULL AND deleted_at IS NULL").all(userId) as {account_id:string}[]).map((row)=>row.account_id);
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
    readShared(receiptId) {
      return db.prepare("SELECT name, mime, data FROM receipts WHERE id = ?")
        .get(receiptId) as StoredReceipt | undefined;
    },
  };
  return { accounts, sessions, ledgers, receipts };
}
