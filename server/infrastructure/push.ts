import type { DatabaseSync } from "node:sqlite";
import type { Session } from "../application/ports.ts";
import type { PushDispatch, PushReceiptCandidate, PushRepository } from "../application/push.ts";

type Row = Record<string, string | number | null>;
const LEASE_MS = 60_000;
const RECEIPT_DELAY_MS = 15 * 60_000;

function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const result = work(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function createPushRepository(db: DatabaseSync): PushRepository {
  const refreshOutbox = (outboxId: string, now: number) => {
    const remaining = db.prepare("SELECT MIN(next_attempt_at) AS next_at, COUNT(*) AS count FROM push_deliveries WHERE outbox_id=? AND sent_at IS NULL").get(outboxId) as Row;
    if ((remaining.count as number) === 0) {
      db.prepare("UPDATE push_outbox SET sent_at=?,next_attempt_at=? WHERE id=? AND sent_at IS NULL").run(now, now, outboxId);
    } else {
      db.prepare("UPDATE push_outbox SET next_attempt_at=? WHERE id=? AND sent_at IS NULL").run(remaining.next_at as number, outboxId);
    }
  };
  const terminalizeMissingToken = (token: string, now: number, userId?: string) => {
    const rows = db.prepare(`SELECT DISTINCT d.outbox_id FROM push_deliveries d JOIN push_outbox o ON o.id=d.outbox_id
      WHERE d.token=? AND d.sent_at IS NULL ${userId ? "AND o.user_id<>?" : ""}`)
      .all(...(userId ? [token, userId] : [token])) as Row[];
    db.prepare(`UPDATE push_deliveries SET sent_at=?,ticket_id=NULL,receipt_checked_at=?
      WHERE token=? AND sent_at IS NULL ${userId ? "AND outbox_id IN (SELECT id FROM push_outbox WHERE user_id<>?)" : ""}`)
      .run(...(userId ? [now, now, token, userId] : [now, now, token]));
    for (const row of rows) refreshOutbox(row.outbox_id as string, now);
  };

  return {
    registerDevice(session: Session, token: string, platform: "ios" | "android", now: number) {
      transaction(db, () => {
        terminalizeMissingToken(token, now, session.userId);
        db.prepare(`INSERT INTO push_devices (token,user_id,session_hash,platform,updated_at) VALUES (?,?,?,?,?)
          ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id,session_hash=excluded.session_hash,
            platform=excluded.platform,updated_at=excluded.updated_at`)
          .run(token, session.userId, session.tokenHash, platform, now);
      });
    },
    removeDevice(session: Session, token: string, now: number) {
      transaction(db, () => {
        const removed = db.prepare("DELETE FROM push_devices WHERE token=? AND user_id=? AND session_hash=?")
          .run(token, session.userId, session.tokenHash);
        if (removed.changes) terminalizeMissingToken(token, now);
      });
    },
    claimDue(now: number, limit: number): PushDispatch[] {
      return transaction(db, () => {
        const outboxes = db.prepare(`SELECT id,user_id FROM push_outbox
          WHERE sent_at IS NULL AND next_attempt_at<=? ORDER BY created_at,id LIMIT ?`)
          .all(now, limit) as Row[];
        const dispatches: PushDispatch[] = [];
        for (const outbox of outboxes) {
          const outboxId = outbox.id as string;
          const existing = db.prepare("SELECT COUNT(*) AS count FROM push_deliveries WHERE outbox_id=?").get(outboxId) as Row;
          if ((existing.count as number) === 0) {
            db.prepare(`INSERT INTO push_deliveries (outbox_id,token,sent_at,attempts,next_attempt_at)
              SELECT ?,d.token,NULL,0,? FROM push_devices d JOIN sessions s ON s.token_hash=d.session_hash
              WHERE d.user_id=? AND s.expires>?`)
              .run(outboxId, now, outbox.user_id as string, now);
          }
          // A logged-out, expired, or transferred device must never receive this user's data.
          db.prepare(`UPDATE push_deliveries SET sent_at=?,receipt_checked_at=? WHERE outbox_id=? AND sent_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM push_devices p JOIN sessions s ON s.token_hash=p.session_hash
              WHERE p.token=push_deliveries.token AND p.user_id=? AND s.expires>?)`)
            .run(now, now, outboxId, outbox.user_id as string, now);
          const remainingSlots = limit - dispatches.length;
          if (remainingSlots > 0) {
            const rows = db.prepare(`SELECT d.token,d.attempts,o.event_type,o.payload FROM push_deliveries d
              JOIN push_outbox o ON o.id=d.outbox_id WHERE d.outbox_id=? AND d.sent_at IS NULL
              AND d.next_attempt_at<=? ORDER BY d.token LIMIT ?`).all(outboxId, now, remainingSlots) as Row[];
            for (const row of rows) {
              db.prepare("UPDATE push_deliveries SET attempts=attempts+1,next_attempt_at=? WHERE outbox_id=? AND token=?")
                .run(now + LEASE_MS, outboxId, row.token as string);
              dispatches.push({ outboxId, token: row.token as string, eventType: row.event_type as string,
                payload: row.payload as string, attempts: (row.attempts as number) + 1 });
            }
          }
          refreshOutbox(outboxId, now);
          if (dispatches.length >= limit) break;
        }
        return dispatches;
      });
    },
    markAccepted(item: PushDispatch, ticketId: string, now: number) {
      transaction(db, () => {
        db.prepare("UPDATE push_deliveries SET sent_at=?,ticket_id=?,next_attempt_at=? WHERE outbox_id=? AND token=?")
          .run(now, ticketId, now + RECEIPT_DELAY_MS, item.outboxId, item.token);
        refreshOutbox(item.outboxId, now);
      });
    },
    markRetry(item: PushDispatch, nextAttemptAt: number, error: string) {
      transaction(db, () => {
        db.prepare("UPDATE push_deliveries SET next_attempt_at=? WHERE outbox_id=? AND token=? AND sent_at IS NULL")
          .run(nextAttemptAt, item.outboxId, item.token);
        db.prepare("UPDATE push_outbox SET last_error=? WHERE id=?").run(error.slice(0, 500), item.outboxId);
        refreshOutbox(item.outboxId, nextAttemptAt);
      });
    },
    markPermanent(item: PushDispatch, now: number, error: string) {
      transaction(db, () => {
        db.prepare("UPDATE push_deliveries SET sent_at=?,receipt_checked_at=? WHERE outbox_id=? AND token=?")
          .run(now, now, item.outboxId, item.token);
        db.prepare("UPDATE push_outbox SET last_error=? WHERE id=?").run(error.slice(0, 500), item.outboxId);
        refreshOutbox(item.outboxId, now);
      });
    },
    removeInvalidToken(token: string, now: number) {
      transaction(db, () => {
        db.prepare("DELETE FROM push_devices WHERE token=?").run(token);
        terminalizeMissingToken(token, now);
      });
    },
    claimReceipts(cutoff: number, limit: number): PushReceiptCandidate[] {
      return transaction(db, () => {
        const current = cutoff + RECEIPT_DELAY_MS;
        const rows = db.prepare(`SELECT outbox_id,token,ticket_id,sent_at,attempts FROM push_deliveries
          WHERE ticket_id IS NOT NULL AND sent_at<=? AND receipt_checked_at IS NULL
          AND next_attempt_at<=? ORDER BY sent_at LIMIT ?`).all(cutoff, current, limit) as Row[];
        for (const row of rows) {
          db.prepare("UPDATE push_deliveries SET attempts=attempts+1,next_attempt_at=? WHERE outbox_id=? AND token=?")
            .run(current + LEASE_MS, row.outbox_id as string, row.token as string);
        }
        return rows.map((row) => ({ outboxId: row.outbox_id as string, token: row.token as string,
          ticketId: row.ticket_id as string, sentAt: row.sent_at as number, attempts: (row.attempts as number) + 1 }));
      });
    },
    markReceiptChecked(item: PushReceiptCandidate, now: number) {
      db.prepare("UPDATE push_deliveries SET receipt_checked_at=? WHERE outbox_id=? AND token=?")
        .run(now, item.outboxId, item.token);
    },
    retryReceipt(item: PushReceiptCandidate, nextAttemptAt: number) {
      db.prepare("UPDATE push_deliveries SET next_attempt_at=? WHERE outbox_id=? AND token=? AND receipt_checked_at IS NULL")
        .run(nextAttemptAt, item.outboxId, item.token);
    },
  };
}
