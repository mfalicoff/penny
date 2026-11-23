# PostgreSQL storage and recovery contract

The .NET API stores everything in PostgreSQL, except receipt bytes, which live encrypted on the filesystem. PostgreSQL **18** is required; the image digest, Npgsql and EF Core versions are pinned.

The schema is defined in code with **EF Core** (`Npgsql.EntityFrameworkCore.PostgreSQL`) and changed only through EF migrations. Raw SQL is kept to the short, documented list in [Raw SQL inventory](#raw-sql-inventory).

## Target schema

PostgreSQL stores the product tables, the derived search and receipt-text tables, the short-lived OIDC attempt table (MAZ-54), the password reset code table (MAZ-123), the mail outbox and emailed invitations (MAZ-124, `mail_outbox`, `household_email_invites`) and EF's `__EFMigrationsHistory`, all in schema `penny`.

| Area | Tables | Notes |
| --- | --- | --- |
| Identity | `users`, `user_avatars`, `oidc_identities`, `sessions`, `oidc_attempts`, `password_resets` | `users` carries the display name and who manages it (MAZ-171), and `user_avatars` the re-encoded picture (cascade-deleted with the user); `oidc_attempts` holds pending OIDC sign-ins (hashed transaction, state, nonce, PKCE verifier, expiry; see [authentication](authentication.md#pending-attempts-in-postgresql)); `password_resets` holds SHA-256 of operator-issued reset codes, one per user (unique `user_id`), with `created_at`/`expires_at`; password hashes are ASP.NET Core Identity v3; no automatic email linking; `sessions.expires_at` is `timestamptz` |
| Receipts | `receipts` | Metadata only. Encrypted bytes live on the filesystem (see [Receipt storage](#receipt-storage)) |
| Personal ledger | `ledgers`, `ledger_accounts`, `ledger_categories`, `ledger_trips`, `ledger_recurring`, `ledger_entries` | Typed v4 ledger. `ledgers` holds currency and the revision; children are keyed `(user_id, id)` |
| Households | `households`, `household_member_periods`, `household_invites` | Trip households carry `trip_start`/`trip_end`; membership is periods only |
| Shared expenses | `household_expenses`, `household_splits`, `household_reimbursements`, `household_recurring`, `household_recurring_allocations`, `household_audit` | Category is typed (`category_name/icon/color`); recurring allocations are rows, not JSON |
| Push | `push_devices`, `push_outbox`, `push_deliveries` | Lease columns (`lease_owner/token/expires_at`) for the MAZ-61 delivery worker; `household_recurring` has the same columns for the MAZ-59 runner. `push_devices.environment` is the APNs `sandbox`/`production` environment; `push_deliveries` records each send's outcome and `last_error` ([push](push.md)) |
| Search | `search_documents` | MAZ-121: normalized texts and embeddings of personal entries and live shared expenses; derived data, rebuildable with `search-rebuild` |
| Receipt text | `receipt_texts`, `receipt_text_chunks` | MAZ-125: text extracted from each receipt on the server (unencrypted, with status, engine and timestamps; also the extraction outbox) and its embedding chunks; derived data, rebuildable with `receipts-ocr` and `search-rebuild` |

Mapping rules:

- **IDs** are `text`, never coerced to UUID, and keep their spelling and case.
- **All text** uses `COLLATE "C"` (bytewise). Email uniqueness is case-sensitive. Don't add `lower(email)` uniqueness without a collision review.
- **Instants** are `timestamptz`; the API returns Unix milliseconds. **Calendar dates** are `date`, never midnight timestamps.
- **Money** is `bigint` cents with checks of 0–99,999,999,999 (totals ≥ 1). **Revisions** are `bigint` limited to JavaScript's safe-integer range.
- **JSON** remains only where content is open-ended: audit `before_json`/`after_json` and the outbox `payload` (`jsonb`).

Constraint decisions:

- Ledger children reference their own ledger's rows through composite keys: `(user_id, category_id)`, `(user_id, account_id)`, `(user_id, trip_id)`, and `(user_id, receipt_id)` to `receipts(user_id, id)`, so an entry can only attach a receipt its owner uploaded.
- **No cascades** except `push_devices → sessions`, `household_recurring_allocations → household_recurring` and `receipt_text_chunks → receipt_texts` (MAZ-125: chunks are derived from the text and go with it). Deleting a category that is still referenced fails (`RESTRICT`). When an account or trip is removed, the ledger writer (MAZ-55) clears entry and rule references in the same save. EF cannot express `SET NULL` on a single column of a composite key.
- `share_cents BETWEEN 0 AND total_cents`. At most one open period per `(household_id, user_id)` (partial unique index). Unique `(recurring_id, expense_date)` per recurring occurrence and `(expense_id, from_user_id)` per expense payment.
- **Deliberately unenforced references:** `recurring_id` on entries and expenses (occurrences outlive their rule), `household_audit.expense_id` (history), and `household_expenses/recurring.account_id`. The last one points to the payer's *personal* account, and the application validates it on write. Personal accounts can be deleted underneath shared expenses.
- Split sums equal the expense total. The shared-expense writer (MAZ-57) enforces this; there is no database trigger.

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
5. **Test.** `MigrationModelTests.whenModelComparedToSnapshot_PendingModelChanges_ShouldBeNone` fails if the model changed without a migration. Integration tests apply all migrations to real PostgreSQL. Add tests for new constraints and for data migrations against real rows.
6. **Apply.** The API applies pending migrations on startup with its own database user (or operators run `migrate` when `Database__MigrateOnStartup=false`). There are no grants to maintain: the same user owns the schema and every table. Readiness returns 503 (`schema`) until the database's applied migrations exactly match the build.

The migration (`DatabaseMigrator`, on startup and in `migrate`) takes an advisory lock, checks PostgreSQL 18, refuses a database whose history contains migrations unknown to this build, creates missing search extensions when the user may, and calls `MigrateAsync` (EF also locks the history table). EF refuses to migrate when the model has changes without a migration.

### Raw SQL inventory

Everything else is EF-generated or a LINQ query. Check-constraint and partial-index predicates are SQL expressions inside the EF model and are tracked by migrations like any other mapping.

| Where | Why EF can't do it |
| --- | --- |
| `DatabaseMigrator`: `pg_try_advisory_lock` / `pg_advisory_unlock` | One session lock, so two migrations (API replicas or `migrate`) never overlap |
| `PreSquashUpgrade` (run by `DatabaseMigrator`): history check, then `DELETE` of the retired push provider's rows, `DROP`/`ALTER` of its columns, `sqlite_import` and `users.salt`, and the history rewrite to `20261113183852_InitialSchema` | Moves a database migrated by the seven pre-squash migrations onto the squashed history in one transaction; EF cannot apply a migration to a history it doesn't know ([upgrading from before the squash](../../apps/backend/README.md#upgrading-a-database-from-before-the-squash)) |
| `TestDataReset` (MAZ-62, test environments only): `DELETE FROM penny."<table>"` per EF table, children first | Clears a disposable `penny_test*` database between full-stack runs with DELETE rather than TRUNCATE; table names come from the EF model and the database name is checked first ([test environment](test-environment.md#test-controls)) |
| `SearchExtensions` (used by `DatabaseMigrator` and `PostgresReadiness`): `SELECT extname, extversion FROM pg_extension` | Search requires pgvector 0.8+ and pg_trgm before migrating; readiness reports `search-extensions` (MAZ-121) |
| `SearchExtensions.EnsureAsync` (used by `DatabaseMigrator`, under its lock): `CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public; CREATE EXTENSION IF NOT EXISTS vector SCHEMA public` in one transaction | Extensions live outside the `penny` schema and EF's model; created only when missing and when the database user may, otherwise the migration stops and asks for an administrator |
| `PostgresSearchRepository`: `SELECT set_config('statement_timeout', ...), set_config('hnsw.iterative_scan', ...), set_config('hnsw.ef_search', ...), set_config('pg_trgm.word_similarity_threshold', ...)` | Transaction-local search settings (2-second statement timeout, filtering inside HNSW scans); the search queries themselves are LINQ (`EF.Functions.Like`, `TrigramsAreWordSimilar`, `TrigramsWordSimilarity`, pgvector `CosineDistance`) |
| `BulkInsert` (MAZ-137, used by `PostgresLedgerRepository.TrySaveAsync`): `COPY penny.ledger_entries (...) FROM STDIN (FORMAT BINARY)` and the same for `penny.search_documents`, each followed by `ANALYZE` of its table when it copied at least 1,000 rows (MAZ-271) | EF inserts tracked rows one statement each, too slow for a first sync of a full ledger. New entries and their search documents are copied in the save's transaction, after `SaveChanges`; the table, columns and types come from the EF model and database-generated identity columns are left out. Updates and deletes stay with EF. The `ANALYZE` makes the statistics count the rows the transaction has copied but not committed. Without it, a VACUUM during the write (autovacuum after other deletes) can record `ledger_entries` as empty: the search documents' foreign-key checks then pick an index that matches only `user_id` and each one scans the user's whole ledger, minutes for a full ledger. The `ANALYZE` lock also keeps VACUUM from replacing those statistics before commit; autovacuum skips the table meanwhile |
| Migration `AddEmailVerification` (MAZ-172): `UPDATE penny.users SET email_verified_at = now()` | One-time backfill: every account that existed before email verification counts as verified (owner decision); EF has no set-based update of existing rows in a migration |

## Concurrency and transactions

- **Ledger compare-and-increment.** `PostgresLedgerRepository.TrySaveAsync` runs `UPDATE ledgers SET revision = revision + 1 WHERE user_id = @u AND revision = @expected` (an EF `ExecuteUpdate`), then reads the cross-aggregate facts the ledger service checks (household currencies, linked accounts, receipt ownership), and applies a keyed diff of the children (insert, update, delete) in the same transaction. EF writes the updates, deletes and new non-entry rows; new entries and their search documents follow as one binary `COPY` per table (MAZ-137), still before commit. The row lock serializes concurrent savers. A loser re-evaluates the predicate after the winner commits, updates nothing, and gets `false` (HTTP 409). A stale or rejected writer changes nothing. HTTP behavior, ordering and retry rules: [ledger sync](ledger.md).
- **Lock order** for future shared writers: households sorted by ID, then affected users sorted by ID, then entities. Bound retries for deadlock and serialization failures, redo validation, and never replay external side effects.
- **Household membership (MAZ-56)** follows that order: every membership writer locks the household row, then (for create and join) the member's `ledgers` row, then re-reads the invite under the household lock (so a replaced or revoked code is rejected) and opens or closes periods, all in one READ COMMITTED transaction. Row locks are EF `ExecuteUpdate` statements that rewrite a column with its own value, so no raw SQL is added. Shared-expense writers must take the household lock first so membership exits see settled balances. Details: [households](households.md#transactions-locking-and-concurrency).
- **Shared expenses (MAZ-57)** follow the same order: the household row (both rows in ascending id for a move), then the payer's `ledgers` row when a payment account is validated, then the expense revision compare-and-increment (`UPDATE household_expenses ... WHERE revision = @expected`, an EF `ExecuteUpdate`), splits, reimbursements, audit and outbox rows, in one READ COMMITTED transaction. No schema change and no raw SQL were added. Details: [shared expenses](shared-expenses.md#transactions-locking-and-concurrency).
- **Workers** claim due rows with expiring lease owner/token columns through a conditional EF `ExecuteUpdate`: a competing claim waits on the row lock, re-checks the lease and skips the row, so no `SKIP LOCKED` SQL is needed. Unique `(recurring_id, expense_date)` prevents duplicate occurrences. Notifications are delivered after commit, at least once.
- **Monthly settlement (MAZ-58)** takes the household row lock first, recomputes the month's balances under it, then inserts the reimbursement, its audit row and push outbox rows in one READ COMMITTED transaction, so repeated or concurrent transfers record once. No schema change and no raw SQL were added. Details: [settlement](settlement.md#transactions-locking-idempotency-and-recovery).
- **Shared recurrence (MAZ-59)** leases due `household_recurring` rows, then records each occurrence in one READ COMMITTED transaction in the shared lock order (household row, payer `ledgers` row, then a compare-and-increment of the rule on its lease token and next date, then the expense, splits, search document, audit and outbox rows). A lost lease or a crash writes nothing; an expired lease is taken over. No schema change and no raw SQL were added. Details: [shared recurrence](shared-recurrence.md#background-processing).
- **Push delivery (MAZ-61)** leases due `push_outbox` rows with the same conditional `ExecuteUpdate`, then prepares and records each message in its own READ COMMITTED transaction that first extends the lease (taking the row lock). Sends happen between those transactions, so delivery is at least once. No raw SQL was added. Details: [push](push.md#delivery-outbox-leases-and-retries).
- **Receipt addresses (MAZ-184, MAZ-193)**: creating or rotating an address first locks the user's `users` row (an EF `ExecuteUpdate` that rewrites `email` with its own value), then revokes the live address and inserts the new one in one READ COMMITTED transaction. Concurrent rotations for one user wait on that lock and revoke the winner's address, so they never collide on the one-live-address index. No raw SQL was added.
- **Search (MAZ-121)** keeps `search_documents` (normalized texts, GIN `gin_trgm_ops` and HNSW `vector_cosine_ops` indexes, embedding outbox columns) in the same transaction as ledger saves and shared-expense writes. Visibility is evaluated at query time from periods and splits. The embedding worker claims due rows with an expiring lease through an EF `ExecuteUpdate` (a competing claim re-checks the lease after the row lock and skips the row), so no `SKIP LOCKED` SQL is needed. `search-rebuild` recreates them from scratch ([search](search.md#operations)).

## Receipt storage

Receipt files are encrypted on the filesystem; PostgreSQL stores only metadata (`receipts`). The store is `Receipts/ReceiptFileStore`; MAZ-60 builds upload, download, MIME/size validation, authorization, `receipts-verify` and `receipts-sweep` on top of it ([receipts](receipts.md)).

- **Key per file:** `HKDF-SHA256(master key, salt = receipts.key_salt [32 random bytes], info = "penny/receipt/v1")` produces a 256-bit AES-GCM key. The master key is never rotated, by decision.
- **Scheme version:** `receipts.encryption_version` (smallint, default 1, checked, MAZ-94) names the derivation and associated-data scheme above. The store writes the current version and refuses to open a row with a version it doesn't know rather than guess. There is no plaintext version: every receipt is encrypted.
- **Encrypted file body *and* filename:** the body is written as `ciphertext || 16-byte tag` with `file_nonce`; the original filename is `name_encrypted` with `name_nonce`. The associated data binds each ciphertext to `(part, user_id, id)`, so files and names can't be swapped between rows.
- **Layout:** `storage_path` is server-generated, `xx/<32 hex>` (checked by a constraint), relative to `Receipts__Root`. No user input reaches the path; raw paths are never exposed.
- **Write order:** temp file (mode 0600), fsync, no-overwrite rename, then commit the metadata. A failure can leave an unreferenced file but never a row without its file. A crash between rename and commit leaves an orphan, which `receipts-sweep` removes once it is an hour old ([backup and restore](receipts.md#backup-and-restore)).
- **Configuration:** `Receipts__Root` (absolute directory) and `Receipts__MasterKey` (base64, 32 bytes) come from the secret manager. Losing the master key makes every receipt unreadable, so back it up separately from the data.

## Commands

Run from the repository root. Local `dotnet.sh run` loads the ignored development `.env`; remote operators supply `ConnectionStrings__Postgres` and the `Receipts__*` settings through their secret manager. Use verified TLS for remote connections.

```sh
bash apps/backend/dotnet.sh run --project src/Penny.Backend.Api -- migrate
```

The API runs the same migration on startup, so `migrate` is needed only with `Database__MigrateOnStartup=false`. The migrations were squashed into a single `InitialSchema` migration. The migration moves a database created before that onto the squashed history automatically, before applying anything else ([backend README](../../apps/backend/README.md#upgrading-a-database-from-before-the-squash)).

### Database user and privileges

The API uses one PostgreSQL login (`ConnectionStrings__Postgres`) for everything: the startup migration, serving and the commands. It owns the `penny` schema and its tables, so there are no grants to apply after a migration. It needs:

- `CREATE` on the database, so EF can create the `penny` schema; or a `penny` schema an administrator created and made it the owner of;
- `pg_trgm` and `vector` (pgvector 0.8+) in `public`. The migration creates them when missing if the login may: a superuser can create both; `pg_trgm` is a trusted extension that a user with `CREATE` on the database may also create, but `vector` is not. Otherwise an administrator runs `CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public; CREATE EXTENSION IF NOT EXISTS vector SCHEMA public;` once.

The bundled Compose PostgreSQL makes this login the container's superuser, so nothing is created by hand; external servers: [deployment](../self-hosting/deployment.md#external-postgresql). Compose installs set up before the single login keep `penny_migrator` as the schema owner and use it as the login ([upgrade](../self-hosting/deployment.md#single-database-user)); the NixOS module reassigns its objects to the new user ([NixOS](../self-hosting/nixos.md#upgrades)). The login can change the schema; the earlier split into a migration role and a restricted runtime role was removed for simpler operation ([operations](../self-hosting/operations.md#database-user-connections-and-tls)).

Readiness fails (503) on PostgreSQL other than 18, applied migrations that don't exactly match the build, missing extensions, a user that cannot read the migration history (`permissions`), or (MAZ-63) a receipt root that is not writable or has less than `Receipts__MinFreeMegabytes` free. It never changes the database; the receipt check writes and deletes one empty probe file. Codes and actions: [operations](../self-hosting/operations.md#monitoring).

## Forward-only recovery

Recovery is forward-only: PostgreSQL point-in-time recovery (WAL archiving) plus receipt-root backups, rehearsed by `PointInTimeRecoveryTests`. Production is never downgraded and migrations are never reversed. Missing data, mismatched revisions, authorization leaks or lost pending edits after a restore are no-go conditions for routing traffic back.

## PostgreSQL backup and restore

Use the pinned PostgreSQL 18 client tools, a restricted password file or injected secrets, verified TLS and encrypted backup storage. Never put connection strings or passwords on command lines.

```sh
pg_dump --format=custom --file=/restricted/penny.dump --dbname=penny
createdb penny_restore
pg_restore --exit-on-error --no-owner --no-privileges --dbname=penny_restore /restricted/penny.dump
```

Receipt metadata is in the dump; receipt bytes are not. Back up `Receipts__Root` **together** with the database: take both under the same write freeze, or take the file backup after the database backup and before any orphan sweep, so every row's file exists. Keep the master key in the secret manager's own backup. The production Compose commands, a tested clean-environment restore and the restore drill are in the [operations runbook](../self-hosting/operations.md#back-up). Restore as the API's login (or, after a restore with `--no-owner --no-privileges` as another user, give that login ownership of the `penny` schema and its objects), then start the API and check readiness before routing traffic. Recovering writes accepted after a dump requires WAL/PITR.
