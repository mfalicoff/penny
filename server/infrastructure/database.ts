import { DatabaseSync } from "node:sqlite";

export function openDatabase(databasePath: string) {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, salt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS oidc_identities (issuer TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY (issuer, subject));
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ledgers (user_id TEXT PRIMARY KEY REFERENCES users(id), revision INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS households (id TEXT PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL, creator_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, archived_at INTEGER);
    CREATE TABLE IF NOT EXISTS household_trips (household_id TEXT PRIMARY KEY REFERENCES households(id), start_date TEXT NOT NULL, end_date TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS household_members (household_id TEXT NOT NULL REFERENCES households(id), user_id TEXT NOT NULL REFERENCES users(id), joined_at INTEGER NOT NULL, left_at INTEGER, PRIMARY KEY (household_id, user_id));
    CREATE TABLE IF NOT EXISTS household_member_periods (id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), user_id TEXT NOT NULL REFERENCES users(id), joined_at INTEGER NOT NULL, joined_on TEXT, left_at INTEGER);
    CREATE INDEX IF NOT EXISTS household_member_period_lookup ON household_member_periods(household_id,user_id,joined_at,left_at);
    CREATE TABLE IF NOT EXISTS household_invites (code_hash TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), expires_at INTEGER NOT NULL, used_at INTEGER);
    CREATE TABLE IF NOT EXISTS household_expenses (id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), title TEXT NOT NULL, total_cents INTEGER NOT NULL, expense_date TEXT NOT NULL, payer_id TEXT NOT NULL REFERENCES users(id), split_mode TEXT NOT NULL, category TEXT NOT NULL, note TEXT NOT NULL, account_id TEXT, receipt_id TEXT REFERENCES receipts(id), revision INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, updated_by TEXT NOT NULL REFERENCES users(id), updated_at INTEGER NOT NULL, deleted_at INTEGER, recurring_id TEXT);
    CREATE TABLE IF NOT EXISTS household_splits (expense_id TEXT NOT NULL REFERENCES household_expenses(id), user_id TEXT NOT NULL REFERENCES users(id), amount_cents INTEGER NOT NULL, PRIMARY KEY (expense_id, user_id));
    CREATE TABLE IF NOT EXISTS household_reimbursements (id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), month TEXT NOT NULL, from_user_id TEXT NOT NULL REFERENCES users(id), to_user_id TEXT NOT NULL REFERENCES users(id), amount_cents INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS household_audit (id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), expense_id TEXT, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, before_json TEXT, after_json TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS household_recurring (id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), title TEXT NOT NULL, total_cents INTEGER NOT NULL, payer_id TEXT NOT NULL REFERENCES users(id), split_mode TEXT NOT NULL, allocations_json TEXT, category TEXT NOT NULL, note TEXT NOT NULL, account_id TEXT, receipt_id TEXT REFERENCES receipts(id), frequency TEXT NOT NULL, next_date TEXT NOT NULL, anchor_day INTEGER NOT NULL, active INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), revision INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS household_recurring_occurrence ON household_expenses(recurring_id, expense_date) WHERE recurring_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS household_expenses_month ON household_expenses(household_id, expense_date) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS household_reimbursements_month ON household_reimbursements(household_id, month);
    CREATE TABLE IF NOT EXISTS push_devices (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE, platform TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS push_outbox (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), household_id TEXT NOT NULL REFERENCES households(id), event_type TEXT NOT NULL, entity_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, sent_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL, last_error TEXT);
    CREATE TABLE IF NOT EXISTS push_deliveries (outbox_id TEXT NOT NULL REFERENCES push_outbox(id), token TEXT NOT NULL, sent_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL, ticket_id TEXT, receipt_checked_at INTEGER, PRIMARY KEY(outbox_id,token));
    PRAGMA user_version=1;
  `);
    const memberPeriodColumns = db.prepare("PRAGMA table_info(household_member_periods)").all() as { name: string }[];
    if (!memberPeriodColumns.some((column) => column.name === "joined_on"))
      db.exec("ALTER TABLE household_member_periods ADD COLUMN joined_on TEXT");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
