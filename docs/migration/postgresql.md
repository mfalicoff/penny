# PostgreSQL storage, import and recovery contract

MAZ-52 implements the PostgreSQL schema, the SQLite import and the receipt file store. MAZ-53–61 own product HTTP workflows and workers, MAZ-121 owns search (schema, `pg_trgm`, indexes), and MAZ-63/65 own deployment and cutover. PostgreSQL **18** is required; the image digest, Npgsql 10.0.3 and EF Core 10.0.14 are pinned.

The schema is defined in code with **EF Core** (`Npgsql.EntityFrameworkCore.PostgreSQL`) and changed only through EF migrations. Raw SQL is kept to the short, documented list in [Raw SQL inventory](#raw-sql-inventory).

## Target schema

The legacy SQLite schema is an import source, not a template. PostgreSQL stores 22 product tables, the search document table (MAZ-121, derived and rebuildable), the short-lived OIDC attempt table (MAZ-54), the password reset code table (MAZ-123), the import checkpoint and EF's `__EFMigrationsHistory`, all in schema `penny`.

| Area | Tables | Notes |
| --- | --- | --- |
| Identity | `users`, `oidc_identities`, `sessions`, `oidc_attempts`, `password_resets` | `oidc_attempts` holds pending OIDC sign-ins (hashed transaction, state, nonce, PKCE verifier, expiry); it is not imported (see [authentication](authentication.md#pending-attempts-in-postgresql)); `password_resets` (migration `AddPasswordResets`) holds SHA-256 of operator-issued reset codes, one per user (unique `user_id`), with `created_at`/`expires_at`; it is not imported; scrypt password/salt text imported unchanged but not verified by .NET (accounts reset with an operator-issued code; see [password reset](authentication.md#password-reset-maz-123)); new hashes are ASP.NET Core Identity v3 with an empty salt column; no automatic email linking; `sessions.expires_at` is `timestamptz` |
| Receipts | `receipts` | Metadata only. Encrypted bytes live on the filesystem (see [Receipt storage](#receipt-storage)) |
| Personal ledger | `ledgers`, `ledger_accounts`, `ledger_categories`, `ledger_trips`, `ledger_recurring`, `ledger_entries` | Typed v4 ledger. `ledgers` holds currency and the revision; children are keyed `(user_id, id)` |
| Households | `households`, `household_member_periods`, `household_invites` | Trip households carry `trip_start`/`trip_end`; membership is periods only |
| Shared expenses | `household_expenses`, `household_splits`, `household_reimbursements`, `household_recurring`, `household_recurring_allocations`, `household_audit` | Category is typed (`category_name/icon/color`); recurring allocations are rows, not JSON |
| Push | `push_devices`, `push_outbox`, `push_deliveries` | Lease columns (`lease_owner/token/expires_at`) for the MAZ-61 delivery worker; `household_recurring` has the same columns for the MAZ-59 runner. Migration `AddApnsPushDelivery` adds `push_devices.provider` (`expo`/`apns`) and `environment` (APNs `sandbox`/`production`, checked per provider), `push_deliveries.provider` and `last_error`, and the pending-by-token index ([push](push.md)) |
| Import | `sqlite_import` | Singleton checkpoint; drop after the cutover observation window |
| Search | `search_documents` | MAZ-121: normalized texts and embeddings of personal entries and live shared expenses; derived data, not imported (`search-rebuild`) |

Mapping rules:

- **IDs** are `text`, never coerced to UUID, and keep their spelling and case.
- **All text** uses `COLLATE "C"` (bytewise, like SQLite `BINARY`). Email uniqueness is case-sensitive, as before. Don't add `lower(email)` uniqueness without a collision review.
- **Instants** are `timestamptz`. Import converts legacy Unix milliseconds exactly; the API keeps returning milliseconds. **Calendar dates** are `date`, never midnight timestamps.
- **Money** is `bigint` cents with checks of 0–99,999,999,999 (totals ≥ 1). **Revisions** are `bigint` limited to JavaScript's safe-integer range.
- **JSON** remains only where content is open-ended: audit `before_json`/`after_json` and the outbox `payload` (`jsonb`).

Constraint decisions:

- Ledger children reference their own ledger's rows through composite keys: `(user_id, category_id)`, `(user_id, account_id)`, `(user_id, trip_id)`, and `(user_id, receipt_id)` to `receipts(user_id, id)`, so an entry can only attach a receipt its owner uploaded.
- **No cascades** except `push_devices → sessions` and `household_recurring_allocations → household_recurring`. Deleting a category that is still referenced fails (`RESTRICT`). When an account or trip is removed, the ledger writer (MAZ-55) clears entry and rule references in the same save. EF cannot express `SET NULL` on a single column of a composite key.
- `share_cents BETWEEN 0 AND total_cents`. At most one open period per `(household_id, user_id)` (partial unique index). Unique `(recurring_id, expense_date)` per recurring occurrence and `(expense_id, from_user_id)` per expense payment.
- **Deliberately unenforced references:** `recurring_id` on entries and expenses (occurrences outlive their rule), `household_audit.expense_id` (history), and `household_expenses/recurring.account_id`. The last one points to the payer's *personal* account, and the application validates it on write. The legacy app let personal accounts be deleted underneath shared expenses.
- Split sums equal the expense total. The importer and the shared-expense writer (MAZ-57) enforce this; there is no database trigger.

## Changing the schema

Every schema change is an EF Core migration. The model (`Schema/Entities`, `Schema/Mappings`) is the source of truth; never edit the database by hand and never hand-write DDL files. Run commands from the repository root.

**A migration requires:**

1. **Change the model.** Edit or add the entity in `src/Penny.Backend.Persistence/Schema/Entities/` and its `IEntityTypeConfiguration` in `Schema/Mappings/` (table name, keys, relationships, indexes, check constraints via `ToTable(t => t.HasCheckConstraint(...))`). Column names become snake_case automatically, and every text column gets `COLLATE "C"`. Expose new tables as a `DbSet` on `PennyDbContext`. Relationships never cascade unless the mapping calls `OnDelete(DeleteBehavior.Cascade)`.
2. **Generate the migration** with a descriptive PascalCase name:

   ```sh
   bash apps/backend/dotnet.sh tool restore
   bash apps/backend/dotnet.sh ef migrations add AddSomething \
     --project src/Penny.Backend.Persistence --startup-project src/Penny.Backend.Persistence \
     --output-dir Migrations
   ```

   This writes `Migrations/<timestamp>_AddSomething.cs`, its `.Designer.cs`, and updates `PennyDbContextModelSnapshot.cs`. Commit all three.
3. **Review the generated SQL** before committing, especially for renames (EF may drop and re-add a column) and data loss:

   ```sh
   bash apps/backend/dotnet.sh ef migrations script <PreviousMigration> AddSomething \
     --project src/Penny.Backend.Persistence --startup-project src/Penny.Backend.Persistence
   ```

   Rename with `migrationBuilder.RenameColumn/RenameTable` rather than drop and add. Backfills that EF cannot express go in `migrationBuilder.Sql(...)` with a comment, and are added to the [Raw SQL inventory](#raw-sql-inventory).
4. **Keep it forward-only and immutable.** Never edit a migration that has been released to any shared database. Fix forward with a new migration. Production is never downgraded (`Down` exists but isn't part of operations). Each migration runs in its own transaction, so avoid statements PostgreSQL forbids in transactions (`CREATE INDEX CONCURRENTLY`). Large-table rewrites need a separate expand/backfill/contract plan.
5. **Update the importer if the change affects imported data.** Update `Import/LegacyTransform.cs` (and `LedgerDocumentMapper.cs`) so the import still produces the new shape, and register any new table in `Import/ImportTables.cs` in foreign-key order. Reconciliation digests every mapped column automatically.
6. **Test.** `MigrationModelTests.whenModelComparedToSnapshot_PendingModelChanges_ShouldBeNone` fails if the model changed without a migration. Integration tests apply all migrations to real PostgreSQL. Add tests for new constraints and for data migrations against real rows.
7. **Apply and grant.** Operators run `migrate` with migration credentials, then re-run `apps/backend/development/grant-runtime.sql`. It grants DML on *all* tables in `penny`, so new tables need no edits there, but it must be re-run after each migration. Readiness returns 503 (`schema`) until the database's applied migrations exactly match the build.

`migrate` takes the shared advisory lock (excluding the importer), checks PostgreSQL 18, refuses a database whose history contains migrations unknown to this build, and calls `MigrateAsync` (EF also locks the history table). EF refuses to migrate when the model has changes without a migration. The runtime role can't migrate: it has no DDL privileges and can't lock the history table.

### Raw SQL inventory

Everything else is EF-generated or a LINQ query. Check-constraint and partial-index predicates are SQL expressions inside the EF model and are tracked by migrations like any other mapping.

| Where | Why EF can't do it |
| --- | --- |
| `InitialSchema` migration: `DROP TABLE IF EXISTS penny.schema_version` | Adopts databases at the released MAZ-51 schema 1, whose version table is superseded by EF history |
| `DatabaseMigrator`: `pg_try_advisory_lock` / `pg_advisory_unlock` | One session lock shared by `migrate` and `import-sqlite` |
| `PostgresReadiness`: role/privilege check (`pg_roles`, `has_*_privilege`) | Proves the runtime role cannot change schema |
| `SqliteImporter`: `has_table_privilege(...)` | Rejects runtime credentials before any import work |
| `SqliteImporter`: `setval(... household_audit sort_order ...)` | Continues the identity after explicit legacy rowids |
| `development/grant-runtime.sql`, `init-roles.sh` | Role and grant administration and `CREATE EXTENSION pg_trgm/vector` (administrator), outside the application. `RuntimeGrants` (MAZ-63) executes the same embedded `grant-runtime.sql` for `migrate --grant-runtime` |
| `TestDataReset` (MAZ-62, test environments only): `DELETE FROM penny."<table>"` per EF table, children first | Clears a disposable `penny_test*` database between full-stack runs with the runtime role (which has DELETE, not TRUNCATE); table names come from the EF model and the database name is checked first ([test environment](test-environment.md#test-controls)) |
| `SearchExtensions` (used by `DatabaseMigrator` and `PostgresReadiness`): `SELECT extname, extversion FROM pg_extension` | Search requires pgvector 0.8+ and pg_trgm before migrating; readiness reports `search-extensions` (MAZ-121) |
| `PostgresSearchRepository`: `SELECT set_config('statement_timeout', ...), set_config('hnsw.iterative_scan', ...), set_config('hnsw.ef_search', ...), set_config('pg_trgm.word_similarity_threshold', ...)` | Transaction-local search settings (2-second statement timeout, filtering inside HNSW scans); the search queries themselves are LINQ (`EF.Functions.Like`, `TrigramsAreWordSimilar`, `TrigramsWordSimilarity`, pgvector `CosineDistance`) |
| `BulkInsert` (MAZ-137, used by `PostgresLedgerRepository.TrySaveAsync`): `COPY penny.ledger_entries (...) FROM STDIN (FORMAT BINARY)` and the same for `penny.search_documents` | EF inserts tracked rows one statement each, too slow for a first sync of a full ledger. New entries and their search documents are copied in the save's transaction, after `SaveChanges`; the table, columns and types come from the EF model and database-generated identity columns are left out. Updates and deletes stay with EF |

## Concurrency and transactions

- **Ledger compare-and-increment.** `PostgresLedgerRepository.TrySaveAsync` runs `UPDATE ledgers SET revision = revision + 1 WHERE user_id = @u AND revision = @expected` (an EF `ExecuteUpdate`), then reads the cross-aggregate facts the ledger service checks (household currencies, linked accounts, receipt ownership), and applies a keyed diff of the children (insert, update, delete) in the same transaction. EF writes the updates, deletes and new non-entry rows; new entries and their search documents follow as one binary `COPY` per table (MAZ-137), still before commit. The row lock serializes concurrent savers. A loser re-evaluates the predicate after the winner commits, updates nothing, and gets `false` (HTTP 409). A stale or rejected writer changes nothing. HTTP behavior, ordering and retry rules: [ledger sync](ledger.md).
- **Lock order** for future shared writers: households sorted by ID, then affected users sorted by ID, then entities. Bound retries for deadlock and serialization failures, redo validation, and never replay external side effects.
- **Household membership (MAZ-56)** follows that order: every membership writer locks the household row, then (for create and join) the member's `ledgers` row, then re-reads the invite under the household lock (so a replaced or revoked code is rejected) and opens or closes periods, all in one READ COMMITTED transaction. Row locks are EF `ExecuteUpdate` statements that rewrite a column with its own value, so no raw SQL is added. Shared-expense writers must take the household lock first so membership exits see settled balances. Details: [households](households.md#transactions-locking-and-concurrency).
- **Shared expenses (MAZ-57)** follow the same order: the household row (both rows in ascending id for a move), then the payer's `ledgers` row when a payment account is validated, then the expense revision compare-and-increment (`UPDATE household_expenses ... WHERE revision = @expected`, an EF `ExecuteUpdate`), splits, reimbursements, audit and outbox rows, in one READ COMMITTED transaction. No schema change and no raw SQL were added. Details: [shared expenses](shared-expenses.md#transactions-locking-and-concurrency).
- **Workers** claim due rows with expiring lease owner/token columns through a conditional EF `ExecuteUpdate`: a competing claim waits on the row lock, re-checks the lease and skips the row, so no `SKIP LOCKED` SQL is needed. Unique `(recurring_id, expense_date)` prevents duplicate occurrences. Notifications are delivered after commit, at least once.
- **Monthly settlement (MAZ-58)** takes the household row lock first, recomputes the month's balances under it, then inserts the reimbursement, its audit row and push outbox rows in one READ COMMITTED transaction, so repeated or concurrent transfers record once. No schema change and no raw SQL were added. Details: [settlement](settlement.md#transactions-locking-idempotency-and-recovery).
- **Shared recurrence (MAZ-59)** leases due `household_recurring` rows, then records each occurrence in one READ COMMITTED transaction in the shared lock order (household row, payer `ledgers` row, then a compare-and-increment of the rule on its lease token and next date, then the expense, splits, search document, audit and outbox rows). A lost lease or a crash writes nothing; an expired lease is taken over. No schema change and no raw SQL were added. Details: [shared recurrence](shared-recurrence.md#background-processing).
- **Push delivery (MAZ-61)** leases due `push_outbox` rows with the same conditional `ExecuteUpdate`, then prepares and records each message in its own READ COMMITTED transaction that first extends the lease (taking the row lock); Expo receipt checks lease `push_deliveries` rows the same way. Sends happen between those transactions, so delivery is at least once. No raw SQL was added. Details: [push](push.md#delivery-outbox-leases-and-retries).
- **Search (MAZ-121)** keeps `search_documents` (migration `AddSearchDocuments`: normalized texts, GIN `gin_trgm_ops` and HNSW `vector_cosine_ops` indexes, embedding outbox columns) in the same transaction as ledger saves and shared-expense writes. Visibility is evaluated at query time from periods and splits. The embedding worker claims due rows with an expiring lease through an EF `ExecuteUpdate` (a competing claim re-checks the lease after the row lock and skips the row), so no `SKIP LOCKED` SQL is needed. `import-sqlite` does not write search documents: run `search-rebuild` after an import ([search](search.md#operations)).

## Receipt storage

Receipt files are encrypted on the filesystem; PostgreSQL stores only metadata (`receipts`). The store is `Receipts/ReceiptFileStore`; MAZ-60 builds upload, download, MIME/size validation, authorization, `receipts-verify` and `receipts-sweep` on top of it ([receipts](receipts.md)).

- **Key per file:** `HKDF-SHA256(master key, salt = receipts.key_salt [32 random bytes], info = "penny/receipt/v1")` produces a 256-bit AES-GCM key. The master key is never rotated, by decision.
- **Scheme version:** `receipts.encryption_version` (smallint, default 1, checked; migration `AddReceiptEncryptionVersion`, MAZ-94) names the derivation and associated-data scheme above. The store writes the current version and refuses to open a row with a version it doesn't know rather than guess. There is no plaintext version: every receipt, imported or uploaded, has been encrypted since MAZ-52, so the migration only labels existing rows as scheme 1.
- **Encrypted file body *and* filename:** the body is written as `ciphertext || 16-byte tag` with `file_nonce`; the original filename is `name_encrypted` with `name_nonce`. The associated data binds each ciphertext to `(part, user_id, id)`, so files and names can't be swapped between rows.
- **Layout:** `storage_path` is server-generated, `xx/<32 hex>` (checked by a constraint), relative to `Receipts__Root`. No user input reaches the path; raw paths are never exposed.
- **Write order:** temp file (mode 0600), fsync, no-overwrite rename, then commit the metadata. A failure can leave an unreferenced file but never a row without its file. A crash between rename and commit leaves an orphan, which `receipts-sweep` removes once it is an hour old ([backup and restore](receipts.md#backup-and-restore)).
- **Configuration:** `Receipts__Root` (absolute directory) and `Receipts__MasterKey` (base64, 32 bytes) come from the secret manager. Losing the master key makes every receipt unreadable, so back it up separately from the data.

## Implemented MAZ-52 commands

The importer reads SQLite **user_version 2**; ledger documents inside it may be v1–v4. Unknown versions, column/key/index drift, unknown tables, views or triggers, and corrupt databases are rejected. Never open an unknown source with the legacy app to stamp it as version 2.

Run from the repository root. Local `dotnet.sh run` loads the ignored development `.env`; remote operators supply `ConnectionStrings__Migration` and the `Receipts__*` settings through their secret manager. Use verified TLS for remote connections.

```sh
bash apps/backend/dotnet.sh run --project src/Penny.Backend.Api -- migrate
bash apps/backend/dotnet.sh run --project src/Penny.Backend.Api -- snapshot-sqlite /absolute/legacy.sqlite /absolute/new-sealed.sqlite
```

`snapshot-sqlite` uses the SQLite backup API from a read-only source connection, includes committed WAL data, writes a standalone journal-free file (mode 0600, never overwriting) and prints its SHA-256. Keep the source, its receipt BLOBs and its WAL together and unchanged. Arrange the final write freeze before snapshotting production.

```sh
bash apps/backend/dotnet.sh run --project src/Penny.Backend.Api -- import-sqlite /absolute/new-sealed.sqlite --sha256 HASH --dry-run
bash apps/backend/dotnet.sh run --project src/Penny.Backend.Api -- import-sqlite /absolute/new-sealed.sqlite --sha256 HASH
bash apps/backend/dotnet.sh run --project src/Penny.Backend.Api -- import-sqlite /absolute/new-sealed.sqlite --sha256 HASH --verify
bash apps/backend/dotnet.sh run --project src/Penny.Backend.Api -- import-sqlite /absolute/new-sealed.sqlite --sha256 HASH --resume
```

The import requires a migrated, **empty, isolated** target, migration credentials, and a writable receipt root. stdout receives a JSON report (source hash and, per target table, a row count and SHA-256); stderr receives progress and redacted errors. Neither contains passwords, tokens, keys, row values or connection strings.

**Transform.** The import validates every source row (strict UTF-8, no NUL, safe integers, real dates, no duplicate JSON keys or unpaired surrogates) and then maps it:

- Ledger JSON becomes typed rows. v1–v3 are upgraded with the client's `upgradeLedger` rule: v1 gains an `investments` category, suffixed on collision, unless it already has one or 300 categories. An entry's embedded receipt becomes `receipt_id`; its name and MIME are served from `receipts`.
- `household_trips` folds into `households.trip_start/trip_end`.
- `household_members` merges into `household_member_periods`. Existing periods are kept, and a member's open/left state must match exactly one open period, otherwise `membership-mismatch`. A member with no periods (older data) gets one synthesized period `legacy-member-<hash>`.
- Expense and rule `category` JSON becomes columns; it must have exactly `name`, `icon` and `color`. `allocations_json` becomes `household_recurring_allocations`.
- Audit rows keep the source rowid as `sort_order`, preserving `created_at` tie order.
- Receipt BLOBs are encrypted into the receipt store as they stream.

Cross-row rules block the import: every user has a ledger, split sums equal totals, a push device's session belongs to its user, and every foreign key holds, including ledger references and receipt ownership. Nothing is repaired or normalized.

**Modes.**

- **Dry run** needs no checkpoint. It performs the whole import in a transaction against the real target (including constraint checks and receipt file writes), reconciles, then rolls back and deletes the files it wrote.
- **Import** commits a `pending` checkpoint bound to the source hash, then inserts all rows in foreign-key order in one repeatable-read transaction. It reconciles and commits the rows together with the `complete` checkpoint and manifest.
- **Resume** restarts from row zero and accepts only the identical sealed source.
- **Verify** recomputes the reconciliation against a `complete` import and changes nothing.

The `migrate` advisory lock is held throughout, and the source hash is checked before reading and again before commit.

**Reconciliation.** The import derives the expected target rows from the source and computes a SHA-256 over **every mapped column of every row**, ordered by primary key, for each table. The same digest of the rows read back must match. JSON compares in canonical form. For receipts, the target side **decrypts every file and filename** and compares owner, name, MIME, size and plaintext SHA-256 with the source BLOB. `--verify` is a frozen pre-cutover gate: post-cutover writes intentionally make it fail.

**Failure recovery.** A cancelled or failed import rolls back all product rows, deletes the receipt files that attempt wrote, and leaves `pending`; `/api/ready` returns 503 until the import completes. Retry `--resume` with the same snapshot after a transient failure. A lost commit acknowledgment may mean the run completed: check `penny.sqlite_import.status` and use `--verify` on `complete`; never clear the checkpoint or re-import. A process crash can leave orphan receipt files; they are harmless and are removed with the target if it is discarded. For a failed source validation, keep the original and the pending target for diagnosis, approve any source remediation separately, and import the new sealed hash into a **new isolated target and an empty receipt root**. Never truncate a live database to make an import succeed.

### Runtime grants

After every `migrate`, apply `apps/backend/development/grant-runtime.sql` as the schema owner or admin. `migrate --grant-runtime` (MAZ-63, used by the production Compose `migrate` service) does this in the same command, as the migration role that owns the schema, in one transaction; the file is embedded verbatim. To run it by hand instead, use psql. For local Compose: `psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1` inside the database container, with the file on stdin. It grants DML on every `penny` table and revokes writes on `__EFMigrationsHistory` and `sqlite_import`. Initialization scripts don't re-run for existing volumes. The script assumes the role is named `penny_runtime`.

Readiness fails (503) on PostgreSQL other than 18, a runtime role that can create schemas or databases or administer roles, applied migrations that don't exactly match the build, a pending import, missing grants or extensions, or (MAZ-63) a receipt root that is not writable or has less than `Receipts__MinFreeMegabytes` free. It never changes the database; the receipt check writes and deletes one empty probe file. Codes and actions: [operations](../operations.md#monitoring).

Databases created by the unreleased schema-2 SQL of earlier MAZ-52 drafts are not adoptable; recreate those development volumes. Databases at the released MAZ-51 schema 1 are adopted by `InitialSchema`.

## Cutover and forward-only recovery

The operator checklist for the production Compose stack, with exact commands, go/no-go gates, rollback, the observation and compatibility windows and Node retirement, is [Cutover](../cutover.md) (MAZ-65). Its `deploy/compose.cutover.yaml` service runs the commands below with the legacy volume mounted read-only, and `scripts/cutover-drill.mjs` drills it on release images. The contract it implements:

1. Rehearse on a production-shaped, sanitized SQLite copy (the automated [cutover rehearsal](parity-report.md#cutover-rehearsal) runs these steps on synthetic data in CI). Compare all reports, authenticate migrated sessions, decrypt receipts and check shared totals. Exercise an interrupted import and resume, and one [password reset](authentication.md#password-reset-maz-123) of an imported password account (`reset-password`, redeem, sign in).
2. Freeze **all** proxy mutations, auth/session/device writes and workers. Drain, stop Node and its workers, then snapshot and hash the final SQLite file. No dual writes.
3. Import and verify into PostgreSQL and the receipt root, then run `search-rebuild` (search documents are derived, not imported) and `search-verify`. Verify existing Expo cookie/bearer/OIDC/receipt journeys and the v1–v4 guards. Switch the existing URL to .NET, then reopen writes.
   **Imported password accounts:** legacy scrypt passwords stop working at the switch; imported sessions keep working until they expire (at most 30 days). Before or at the switch, tell every imported password user (`users` rows whose `password` and `salt` are both non-empty) that they must request a reset code from the operator to sign in with a password again, and how it will reach them. Operators may pre-issue codes after the final `--verify` with `reset-password EMAIL` (issuing touches only `password_resets`; redeeming changes `users`). There is one code per account, and each lasts `Auth__PasswordResetHours` (default 24 hours), so issue codes when you can deliver them, or re-issue later. OIDC users are unaffected.
4. **Before reopening writes**, rollback means discarding the PostgreSQL target and receipt root and resuming Node on the untouched SQLite source.
5. **After reopening writes, recovery is forward-only:** PostgreSQL point-in-time recovery (WAL archiving) plus receipt-root backups ([rehearsed](parity-report.md#recovery-after-writes-reopen) by `PointInTimeRecoveryTests`). There is no reverse export to SQLite and no mutation journal. Never restore the old SQLite snapshot over accepted data.

Missing data, mismatched revisions or checksums, authorization leaks or lost pending edits are no-go conditions. Retain the sealed source, target backups and receipt-root backups through the observation window.

## PostgreSQL backup and restore

Use the pinned PostgreSQL 18 client tools, a restricted password file or injected secrets, verified TLS and encrypted backup storage. Never put connection strings or passwords on command lines.

```sh
pg_dump --format=custom --file=/restricted/penny.dump --dbname=penny
createdb penny_restore
pg_restore --exit-on-error --no-owner --no-privileges --dbname=penny_restore /restricted/penny.dump
```

Receipt metadata is in the dump; receipt bytes are not. Back up `Receipts__Root` **together** with the database: take both under the same write freeze, or take the file backup after the database backup and before any orphan sweep, so every row's file exists. Keep the master key in the secret manager's own backup. The production Compose commands, a tested clean-environment restore and the restore drill are in the [operations runbook](../operations.md#back-up). After a restore with `--no-owner --no-privileges`, restore schema ownership, re-run `grant-runtime.sql` and check readiness before routing traffic. Recovering writes accepted after a dump requires WAL/PITR.
