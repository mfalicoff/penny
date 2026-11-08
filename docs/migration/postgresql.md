# PostgreSQL storage, import and recovery contract

MAZ-52 implements this mapping; MAZ-59/61 own workers, MAZ-121 search and MAZ-63/65 deployment/cutover. PostgreSQL 18 is selected; versioned migrations pin patch/image digest and provider lock before staging. A migration role installs `pg_trgm`, indexes and grants. Runtime has no extension/schema privileges. Readiness fails on missing migration, extension or projection generation. Managed hosts must support the extension; no silent unindexed replacement.

## Schema and encoding

Read `PRAGMA user_version` (currently 2) and actual columns/indexes from `server/infrastructure/database.ts`. Reject unknown versions, malformed rows, broken FKs, duplicates and invalid dates/integers with redacted table/key diagnostics. Import into an empty isolated target in FK order; checkpoints bind to frozen source SHA-256/schema version. Reject resume against another source. Never mutate the source. MAZ-52 supplies dry-run, resume, validation and finalization commands before production.

| SQLite source | PostgreSQL mapping/invariant |
| --- | --- |
| IDs/FKs | `text`, never UUID coercion; preserve spelling/case and composite keys |
| Users/password/salt/OIDC | `text`, preserve scrypt encoding/parameters, hex salt, uniqueness and issuer/subject mapping; no automatic email linking |
| Sessions/invites | Existing hash `text`, expiry `bigint` Unix milliseconds; preserve revocation, single-use state and cascades |
| Ledgers | Validated `jsonb`, `bigint` revision constrained to JS safe integers; preserve optional fields, arrays, IDs and cents; compare semantic JSON |
| Receipts | `bytea`, identical length and SHA-256, owner/MIME/name/ID/URL |
| Households/trips/members/periods | Text FKs, `bigint` millisecond timestamps; null stays null; joined_on/trip dates use `date` serialized without timezone |
| Expenses/splits/reimbursements | `bigint` cents/revisions with existing limits (money <=99,999,999,999); expense `date`, checked `YYYY-MM` month; preserve soft deletion and expense-payment partial uniqueness |
| Recurrence | Strict 0/1 to `boolean`, date-only next date, integer anchor, `jsonb` allocations/category; retain recurring/date uniqueness |
| Audit/category JSON | `jsonb`, preserve absent/null and historical actor/time; redact private accounts as before |
| Push devices/outbox/deliveries | Preserve session FK, tokens, retry/receipt state and uniqueness; millisecond times; `jsonb` payload; additive persisted lease metadata |
| Search (derived, new) | Viewer/source/entity key, date/kind/cents, sanitized labels, canonical substring text, `tsvector`, source revision and generation |

UTF-8 text is not normalized or accent-stripped. JSONB cannot represent U+0000 or unpaired surrogates: dry-run detects these and blocks for approved remediation/export, never silently drops text. Use exact integer APIs in C#/Swift. Never reinterpret milliseconds as seconds or dates as timestamp midnights. [Storage fixtures](../../contracts/fixtures/storage-mapping.json) record cross-stack edge cases.

## Atomic projections and concurrency

One transaction validates ownership/constraints/revisions, compares/increments revision, changes authoritative rows, updates/deletes affected search rows, increments each viewer's `searchRevision`, and appends audit/outbox/recovery-journal records. Rejection/409 rolls everything back. Reads do not materialize occurrences. Shared workers follow the same write boundary. Category/account renames/deletions rebuild affected text within the commit; shared edits/moves update old/new viewers. Build each viewer's document after removing payer-private account labels.

Use one lock order everywhere: households sorted by ID, affected users sorted by ID, then entities. This includes personal saves validating household constraints, membership changes, settlement and workers. Lock/recheck membership and settlement inside the transaction. A ledger CAS must update exactly one row or return 409. Bound retries for deadlock/serialization failures, redo validation and never replay an external side effect. Search joins current/historical visibility rules; projection presence is never authorization. Revocation removes inaccessible hits and increments generation in the same commit.

Backfill builds a new generation from a consistent snapshot, replays mutations after its watermark, takes a brief writer lock to catch up/verify counts/checksums and swaps generations atomically. Serve the old generation until then. Persist checkpoints; restart resumes/discards incomplete work without exposing half an index. Reconciliation compares authoritative recorded keys/labels/revisions and repairs under the same locks. MAZ-121 must implement and test rebuild/reconcile commands; these are not delivered here. Do not log document/query text.

## Worker and outbox leases

Workers claim due schedules/outbox rows in short transactions with `FOR UPDATE SKIP LOCKED` and persisted expiring owner/token leases. Schedule materialization locks/rereads rule and membership; unique `(recurring_id,expense_date)` prevents duplicates. Advance next date only with occurrence, search, audit and outbox commit. Deliver notifications after commit outside locks, and acknowledge only a matching lease token. Expired leases are reclaimable; stale acknowledgments cannot clear newer work. Delivery is at least once, not exactly once; preserve event/delivery keys and provider/environment separation. Reconcile uncertain provider outcomes where possible. Test two workers, crashes, cancellation, lease expiry and transport failure in MAZ-59/61.

## Cutover and accepted-write recovery

1. Rehearse a production-shaped sanitized SQLite copy using backup APIs or a checkpointed backup including WAL. Compare all table counts/keys/revisions, semantic ledger/audit JSON, session authentication, receipt byte checksums and shared totals. Exercise interrupted import/resume and extension privilege failure.
2. Freeze **all** proxy mutations, auth/session/device writes and workers. Drain requests, stop Node/workers, seal/hash final SQLite backup and manifest. No dual writes; any continued reads use a known frozen instance.
3. Import/finalize PostgreSQL and search; verify existing Expo cookie/bearer/OIDC/receipt journeys and v1–v4 guards. MAZ-64/65 require signed reconciliation evidence. Switch the existing URL to .NET before reopening writes/workers. Maintenance returns 503/Retry-After; clients retain pending personal changes.
4. During observation, transactionally journal **every** accepted mutation with sequence, affected keys, before/after revisions and full replay data, including auth/session/receipt bytes, worker changes and revocations. Encrypt/restrict this financial recovery data; it is not application logging. Journal failure fails the write. Checkpoint backup plus journal enables forward recovery.
5. Prefer application rollback compatible with PostgreSQL. Returning to Node/SQLite requires another write freeze/drain, PostgreSQL snapshot/final journal watermark, and rehearsed reverse export/replay into a **new** SQLite file based on the sealed source. Reconcile accepted writes, deletes, receipts, sessions, audit and outbox acknowledgments before reopening. Remain unavailable if replay is unsupported. Never simply restore old SQLite over accepted writes.

MAZ-65 cannot open production writes until reverse replay or an explicitly chosen forward-recovery-only plan is implemented and rehearsed. Missing data, mismatched revisions/checksums, authorization leaks or lost pending edits are no-go conditions. Retain sealed source, target backups and journal through the approved observation/retention window. Search indexes are rebuildable; authoritative data is not.

Mechanisms: [PostgreSQL full text](https://www.postgresql.org/docs/18/textsearch.html), [pg_trgm](https://www.postgresql.org/docs/18/pgtrgm.html), [row locks](https://www.postgresql.org/docs/18/explicit-locking.html), [SKIP LOCKED](https://www.postgresql.org/docs/18/sql-select.html), [Npgsql mapping](https://www.npgsql.org/efcore/mapping/full-text-search.html). The transaction/recovery rules above are Penny decisions requiring implementation evidence.
