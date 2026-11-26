# Architecture decisions

These decisions (MAZ-50, accepted 2026-11-07) still shape v2: the native iOS app, the web app and the .NET API on PostgreSQL.

## ADR 001: preserve the public boundary; PostgreSQL storage

**PostgreSQL 18 is the server database.** Device and browser durable stores remain local; they never connect to PostgreSQL.

The API keeps `/api` paths, camelCase JSON, ledger v4, arbitrary existing string IDs, integer revisions, session hashes/expiry, receipt IDs/bytes and shared visibility. JSON key order is not a contract; array order and absent/null distinctions are. Search v1 is additive, defined in [search.md](search.md).

| Path | Ownership |
| --- | --- |
| `apps/web/src/domain/`, `tests/` | Shared TypeScript rules (run by the web app), golden fixture generator and their regression suites |
| `apps/backend/` | ASP.NET Core API, application/domain ports, PostgreSQL persistence and integration tests |
| `apps/ios/` | Swift/SwiftUI iPhone/iPad presentation, domain rules, durable local data and XCUITest |
| `apps/web/` | React/TypeScript, TanStack Router/Query, accessible DOM and durable browser data |
| `contracts/` | OpenAPI, sanitized fixtures and design trace snapshot for all stacks |
| `docs/migration/` | Decisions and per-feature reference for the API |

## ADR 002: calculation and conflict ownership

Personal commands, recurrence materialization and three-way merge are client-owned (`apps/web/src/domain/ledger.ts`, `commands.ts`, `merge.ts` and their Swift ports). Save `{base,local}` durably before acknowledging a personal save. Generate IDs once, serialize saves and refetch/merge/retry 409s. Local edited fields win same-field races; untouched remote fields survive. Local deletions remove entries; locally edited remotely deleted entries can reappear under the existing algorithm. Preserve failed pending work. The API validates whole-ledger writes and atomically compares/increments revisions; it never silently merges or generates personal recurrence. Personal recurrence uses the local calendar and preserves anchor days.

Shared allocation, historical membership, recurrence, monthly settlement, reimbursements and personal projections are server-owned (`apps/web/src/domain/households.ts` is the TypeScript reference for the split and settlement rules). Project shared expenses exactly once; do not insert them into private ledgers. Only the payer sees their private account reference. Recorded `transactions` and month-only `scheduled` previews remain separate. Home labels expected income; Activity, spending and widgets use recorded entries. Reimbursements record existing payments, never move money or create spending. All stacks use integer cents, basis points and date-only calendar strings.

## ADR 003: versioning

Accept validated v4 ledgers only and return `{revision,ledger}`; any other version gets 400. There is no client-version header or minimum build; do not invent a 426 gate for existing routes. Future incompatible changes require negotiated capabilities and coordinated clients. Tolerate additive response fields; never save unknown ledger versions destructively. `/api/info` remains public `{name:"penny",version,privacyPolicyUrl}` for credential-free signed-out server verification; `privacyPolicyUrl` is the operator's `Legal__PrivacyPolicyUrl` or null, and is absent from older servers.

Never send credentials to a candidate server. Device-local biometric lock conceals dialogs/content on inactive/background transitions, fails closed on preference read failure and preserves drafts. Web omits lock/server selection.

## ADR 004: redesign and platform scope

The iOS-native redesign ([docs/design/penny-ios](../design/penny-ios/README.md), 82 cards, and the 42-component [design-kit](../../design-kit/package.json), synced to the [Penny Claude Design project](https://claude.ai/design/p/173b576e-aa32-44dc-9f83-23f0ea8df538)) is the visual and interaction baseline, traced in [design-baseline.json](../../contracts/design-baseline.json) and [redesign.md](redesign.md). On iPhone, Home / Activity / Shared / Trips tabs and a separate add button replace More; Recurring, Accounts, Categories and Settings open in a Settings sheet, and every route keeps a destination (`navigation.routes` in the baseline). Light and dark follow the system; SF Pro and SF Symbols on iOS, Inter and Ionicons on the web. Native iOS 26 Liquid Glass is required on the control layer, with explicit OS and accessibility adaptations. There is no Android app.

MAZ-132 re-baselined the contract on these cards. The contract records card and source hashes, every card and control owner and acceptance scenario. MAZ-122 added the light and dark baselines and the per-card verdicts for the iOS and web apps (`contracts/visual-comparisons.json`, [visual acceptance](../design/visual-acceptance.md)). MAZ-69/85 own controls; MAZ-82/96 own visual/functional release gates.

See the [API reference](api-reference.md) and the [PostgreSQL contract](postgresql.md).

## ADR 005: change-based personal ledger sync (deferred)

**Status:** proposed, deferred by the owner on 2026-11-25 (MAZ-186).

**Context.** Personal sync is whole-document (ADR 002, [ledger](ledger.md)): every pass starts with a full `GET /api/ledger`, and every save sends and receives the whole ledger, which the server re-parses, re-validates and diffs. The [baseline](ledger-sync-baseline.md) measured about 180 bytes per entry raw: 352 KiB and 142 ms of server time per one-entry save at 2,000 entries, and 8.5 MiB and 3.1 s at 50,000. The same baseline found a quadratic step in the web merge, which was fixed, and added compression to the ledger responses.

**Decision, when it is built:**
- **Pull:** `GET /api/ledger/changes?since=<revision>` returns the records changed after that revision, the ids deleted after it, and the current revision.
- **Push:** `POST /api/ledger/changes` takes `{baseRevision, upserts {accounts, categories, trips, recurring, entries}, deletes {…ids}, currency?}`. The answer is the new revision and the stored form of the changed rows (receipts with their served name, MIME type and URI).
- **Storage:** each of the five ledger tables gets a `changed_revision` column. Deletes become tombstones in `ledger_tombstones(user_id, kind, id, revision)`, kept for 180 days. A `since` older than the oldest kept tombstone gets 410, and the client does one full `GET`.
- **Conflicts stay ledger-level:** any change since `baseRevision` gives 409. The client then pulls, merges and pushes again. The client-side three-way merge doesn't change, and neither do its golden fixtures. New golden fixtures cover applying a change set.
- **Validation is unchanged:** the push runs in the existing locked READ COMMITTED transaction. The batch is applied to the current rows in memory, and today's validation runs on the result.
- **Clients:** the changes to push are the difference between `base` and `local`, so there's no new queue. Pulled changes are applied to `base`, then the existing merge runs.
- **Compatibility:** `GET` and `PUT /api/ledger` stay, deprecated, for older app builds, and are removed in a later major version (ADR 003). Whole-document writes also stamp `changed_revision` and write tombstones.
- **Rollout in two phases:** first the API, contract and web on Linux, then iOS on the Mac, with the baseline measured again before and after.

**Why deferred.** At about 2,000 entries, today's sync costs 0.2–0.5 s and about 55 KiB compressed per response. Linear merging and compressed responses cover today's cost, without a new contract version or a schema change.

**Revisit when** typical ledgers approach tens of thousands of entries, or saves take longer than about 1 s.

## ADR 006: encrypt ledger data at rest

**Status:** proposed, for the owner's review (MAZ-295, with the key infrastructure of MAZ-293). Nothing is built yet.

**Context.** Every ledger row is plaintext in PostgreSQL: entry, rule and shared expense titles, notes and categories, account and trip names, household names, the normalized search texts and their embeddings (`search_documents`), receipt text and its chunks (`receipt_texts`, `receipt_text_chunks`) and the household audit snapshots (`household_audit.before_json`, `after_json`). Anyone who gets a `pg_dump`, a base backup, the WAL archive, the volume or database credentials reads every ledger. Only receipt files and names, inbound mail, receipt inbox subjects and senders and receipt mail addresses are sealed today, all with keys derived from the one never-rotated `Receipts__MasterKey` (`ReceiptFileStore`, `InboundMailSealer`).

What the code relies on, which limits what can be sealed:

- **Text is only used in SQL by search.** Ledger reads order by id and date ([ledger](ledger.md#storage-mapping-and-read-order)); no query filters, sorts or joins on a title, note or name. The only SQL over text is search: `LIKE` and `pg_trgm` `<%` on `search_documents.{title_text, document_text, owner_text}` and `receipt_texts.search_text`, and pgvector HNSW on the embeddings (`PostgresSearchRepository`). Validation runs in C# on the parsed document. Text length checks (`ck_*_title`, `ck_*_note`, `ck_*_name`) duplicate the API's validation.
- **Shared amounts are summed in SQL.** Monthly balances and recaps group and sum `household_expenses.total_cents`, `household_splits.amount_cents` and `household_reimbursements.amount_cents` under the household lock (`PostgresHouseholdTransaction`). Personal amounts are only read back and projected; search sorts by `search_documents.amount_cents`.
- **Shared rows outlive their members.** Account deletion (MAZ-152, `PostgresAccountDeletionRepository`) keeps the person's shared expenses, splits and payments, strips their account names and receipts from them, and deletes every personal row.
- **The audit checks JSON in SQL.** `ck_household_audit_before_private` and `ck_household_audit_after_private` reject snapshots carrying `accountId` or `receipt.name`.
- **Emailed receipts arrive without the person.** The inbound worker seals and parses mail and runs OCR with nobody signed in.

### Threats

| Threat | 1. Server-side field encryption, per-user keys | 2. End-to-end encryption | 3. Disk encryption or TDE only |
| --- | --- | --- | --- |
| Stolen `pg_dump`, base backup or WAL archive | **Protected** (text and personal amounts), if the key isn't stored with the backup | Protected | **Not protected**: a dump is logical, so it's plaintext; WAL archives too unless the archive is encrypted |
| Stolen disk, volume or VM snapshot | Protected | Protected | Protected (volume) / protected (TDE) |
| Database administrator (SQL access, no API secrets) | **Text protected.** Sees amounts, dates, counts, ids and lengths; can delete rows or replay a row's older ciphertext (AAD stops moving ciphertext between rows, users or columns) | Protected, same metadata | Not protected |
| Compromised running API or its host | **Not protected**: it holds the keys and decrypts on demand | Content protected from iOS; **not** from the web app, which the compromised server serves | Not protected |
| Operator holding the secrets | Not protected (on a self-hosted install the operator is usually the user) | Protected | Not protected |
| **Cost** | Medium: one key service, sealed columns, in-memory search, an online migration. No API contract or client change | Very large: server-side search, OCR, emailed receipts, ledger validation and settlement over amounts all move to the clients or stop working; household key exchange and device recovery; lost devices lose data. Penny Cloud-sized | Small: documentation, plus a forked PostgreSQL for TDE (community PostgreSQL 18 has none, and the pinned `pgvector/pgvector` image would have to change) |

### Decision

**Option 1, server-side field encryption with per-user and per-household keys**, plus encrypted volumes and encrypted backup storage as the documented baseline (option 3 as defense in depth, not as the protection). It protects what the audit found (dumps, backups, disks and database access) without changing the API contract, the clients, settlement or emailed receipts. End-to-end encryption stays out of scope until Penny Cloud.

#### Key hierarchy

```text
root key v1, v2, …            operator secret (Encryption__Keys__<n>), versioned; never in PostgreSQL or stateDir
  └─ KEK_n = HKDF(root_n, info "penny/kek/v1")
       └─ wraps (AES-256-GCM) each data key row in penny.data_keys
            ├─ user data key (one per user, versioned)
            │    ├─ HKDF info "penny/field/v1"         ledger rows, search documents
            │    ├─ HKDF info "penny/receipt/v2"        receipt files, names and receipt text (MAZ-293)
            │    └─ HKDF info "penny/inbound-mail/v2"   raw mail, inbox subject and sender, receipt address (MAZ-293)
            └─ household data key (one per household, versioned)
                 └─ HKDF info "penny/field/v1"          shared expenses and rules, household name, audit, shared search documents
```

- **Root keys** are 32 random bytes, base64, in the secret manager: `Encryption__Keys__1`, `Encryption__Keys__2`, … and `Encryption__ActiveKey`. The existing `Receipts__MasterKey` becomes the read-only **legacy** key: it still opens version 1 receipts and mail until they are re-sealed, then the operator removes it. On NixOS the keys come from systemd credentials (`LoadCredential`), outside `stateDir`, so a backup of `/var/lib/penny` never holds ciphertext and keys together (MAZ-293).
- **`penny.data_keys`** `(scope 'user'|'household', owner_id, version, kek_version, nonce, wrapped, created_at, retired_at)`, unique on `(scope, owner_id, version)`. The wrapped key's associated data is `penny/data-key/v1\0{scope}\0{owner_id}\0{version}`. A user's key is created with the account (or lazily on first write during the migration), a household's with the household. New writes use the newest unretired version.
- **A key check value** (`HMAC(KEK_n, "penny/kcv")`) per root version is stored in `penny.key_versions`, so startup and readiness fail with a clear message when a configured key is wrong or a key still referenced by `data_keys.kek_version` is missing, instead of failing tags at read time.
- **Purpose separation.** The field, receipt and mail keys are derived subkeys, so no key covers two purposes (MAZ-293's "separate keys"), and every purpose is shredded with its owner's data key.
- **Households hold their own key**, wrapped by the KEK, not by the members' keys: membership stays a server-side authorization rule, so joining, leaving and history visibility don't touch keys. Shared rows stay readable after a member deletes their account, as MAZ-152 requires.
- **In memory**, unwrapped data keys are cached per process for 10 minutes (LRU, zeroed on eviction). Unwrapping costs about 3 µs, so the cache only saves the `data_keys` read.

#### Envelope

One sealed record per row, not per column: a `sealed bytea` column holding

```text
format (1 byte = 1) | data key version (4 bytes, big-endian) | nonce (12) | ciphertext | tag (16)
```

AES-256-GCM with a random 96-bit nonce, and associated data `penny/field/v1\0{table}\0{scope}\0{owner_id}\0{row id}`. The plaintext is a small versioned record (length-prefixed UTF-8 fields, then integers), padded to a multiple of 32 bytes so the ciphertext length gives only a coarse size. One envelope per row costs 33 bytes and one AEAD call whatever the number of fields, and an empty note costs nothing. The format byte and data key version let old and new keys, and old and new record layouts, coexist during migration and rotation. At about 10^6 seals per data key a year, the random-nonce limit of GCM (2^32 messages per key) is far away; the data key rotates anyway when `rotate-keys` runs.

#### What is sealed

| Table | Sealed (into `sealed`) | Stays plain | Why plain |
| --- | --- | --- | --- |
| `ledger_accounts` | `name` | `type` | An enum (`bank`, `card`, `cash`, …) |
| `ledger_categories` | `name`, `icon` | `color`, `kind` | A color and an expense/income flag say little; check constraints use them |
| `ledger_trips` | `name` | dates, `shared_household_id` | Foreign key; trip dates gate shared trips |
| `ledger_recurring` | `title`, `note`, `total_cents`, `share_cents` | dates, `frequency`, `anchor_day`, `active`, `kind`, `participants`, ids | The recurrence clock and the foreign keys |
| `ledger_entries` | `title`, `note`, `total_cents`, `share_cents` (and the per-entry amount fields of MAZ-151) | `entry_date`, `kind`, `participants`, ids, currency codes | The `(user_id, entry_date)` read order and the foreign keys |
| `households` | `name` | currency, dates, creator | Membership and trip rules |
| `household_expenses`, `household_recurring` | `title`, `note`, `category_name`, `category_icon` | `total_cents`, dates, payer, split mode, `category_color`, account and receipt ids, revision, lease | Settlement sums `total_cents` in SQL under the lock |
| `household_splits`, `household_recurring_allocations`, `household_reimbursements` | nothing | everything | Amounts and members only, summed in SQL |
| `household_audit` | `before_json`, `after_json` (sealed under the household key) | ids, actor, action, `created_at`, `sort_order` | The history is read by expense and household |
| `search_documents` | `title_text`, `document_text`, `owner_text`, `embedding_source`, `amount_cents` of personal rows, `embedding` (into `sealed_embedding`) | keys, scope, `kind`, `item_date`, `receipt_id`, model and outbox columns | Authorization and filters stay in SQL |
| `receipt_texts`, `receipt_text_chunks` (MAZ-293) | `content`, `search_text`, `passage`, `embedding` | status, method, engine, pages, outbox columns | Extraction outbox |
| `receipts`, `receipt_inbox_items`, `receipt_mail_addresses`, `inbound_messages` | already sealed; re-sealed under the owner's data key (`encryption_version` 2) | `local_part_hash`, sizes, MIME types, statuses | The address lookup uses the hash |

**Amounts.** Personal amounts are sealed: nothing in SQL computes with them, so the only cost is moving their check constraints into the writer and the `amount` sort of search into memory (which the search design below does anyway). Shared amounts stay plain: sealing them would move monthly balances, recaps and reimbursement checks out of SQL and out of the household lock, for metadata the database administrator still mostly infers from splits and reimbursements. **What a dump still shows:** for each user, how many entries and rules exist, their dates, kinds, category, account and trip ids, colors and account types; for each household, every shared amount, date, payer and split, every reimbursement, and who did what when in the audit. Ids are chosen by the clients (the web's `uid()` is random), but legacy and default ids such as a category called `groceries` still say what they are.

**Out of scope, still plain:** `users.email` and `household_email_invites.email` (sign-in and invitation lookup; a keyed blind index could replace them later), `users.display_name` and `user_avatars` (profile, shown to household members, cleared on deletion), session, invite and reset hashes, and the outboxes (`push_outbox` payloads hold ids only, and `PushContent` is generic per event type).

#### Search

Searching sealed text keeps the [search v1](search.md) contract (tiers, thresholds, relevance, cursors and access rules) and moves matching from PostgreSQL indexes into the API's memory:

1. **Authorize and filter in SQL, as today.** One REPEATABLE READ statement finds the viewer's scopes (their own ledger, and each household they may see under the membership-period rules, with the expenses visible to a former member) and applies the plain filters (`item_date` range, `kind`, household).
2. **Decrypt per scope, through a cache.** For each scope the API keeps its decrypted documents (normalized title, document and owner texts, personal amounts) and their embeddings, keyed by the scope's revision (the ledger revision, or a per-household search revision bumped in the same transaction as any shared write). A miss reads the scope's sealed rows and opens them. The cache is bounded (`Search__CacheMegabytes`, default 256) and evicts least-recently-used scopes. Vectors stay float32: int8 would move scores near the tuned 0.82 threshold, whose binding fixture has 0.002 to spare.
3. **Match in memory.** Tier 1 and 2 are ordinal substring tests on the normalized texts. Tier 3 is a C# port of `pg_trgm`'s `word_similarity` with the same 0.6 threshold, tested against PostgreSQL's answers on the search fixtures and a generated corpus while both paths exist. Tier 4 is a brute-force cosine scan, top 200, with the existing per-query threshold (`MeaningThreshold`). Then the same relevance order, keyset cursor and count.
4. **Receipt text** follows the receipt's own visibility, as today: its sealed text and chunks are opened under the receipt owner's key only when the receipt download rule allows the viewer.

The GIN trigram indexes and the HNSW indexes are dropped; `search_documents` keeps its btree indexes for scopes and dates.

**The remaining leak** is none beyond the envelope's: no token, hash or vector of the text is stored in the clear, so a dump shows only which rows exist, their dates and padded sizes. In the running API, the cache holds plaintext, which option 1 already accepts. Swap and core dumps must stay off or encrypted (`LimitCORE=0` in the NixOS unit and the container).

**Rejected alternatives:**

- **Blind indexes (keyed trigram tokens).** HMAC of each trigram with a per-scope key, in an `int4[]` with a GIN index, then decrypt the candidates and verify. Measured 36 tokens per entry and about 4 s to compute for 100,000 entries. It keeps search inside PostgreSQL, but the tokens are deterministic per user: their frequencies and co-occurrences let a dump holder recover common words and merchant names by frequency analysis, and equal documents look equal. Kept as the fallback if the in-memory cache turns out too large for some installs, with tokens truncated to 16 bits so they collide and leak less, at the cost of more candidates to verify.
- **Keeping embeddings plain.** Embedding inversion recovers much of a short text such as an entry title, so a plain vector next to a sealed title would undo the sealing.
- **Client-side search only.** The clients already search locally (tiers 1–2), but typo and meaning matching, receipt text and shared expenses need the server.

#### Households, settlement and the audit

- Shared expenses, rules and the household name are sealed under the household key; the shared search document too, including the payer's account name in `owner_text` (matched only for the payer, as today). Account deletion already rewrites that text without the account name.
- Settlement, recaps and reimbursements keep running in SQL on the plain amounts. Their views get titles and category names by opening the rows in memory; shared recurrence materialization opens the rule and seals the new expense with the same household key.
- **The audit** is sealed under the household key. The two private-field check constraints can no longer see the JSON, so the same rule moves into the audit writer (it rejects a snapshot with `accountId` or `receipt.name`), with a test that every writer goes through it. **Retention:** events older than `Households__AuditRetentionMonths` (default 24) are deleted by the maintenance runner; recaps and balances don't read the audit, so nothing else changes. Archived households keep their history until the retention removes it.

#### Exports and emailed receipts

- **Exports** (MAZ-152) are built from the services after decryption, so `ledger.json`, `entries.csv`, the household files and the receipts are unchanged. The ZIP is written to a temporary file today; it is written sealed with a random per-download key held only in memory, so a disk snapshot taken during a download holds no plaintext.
- **Emailed receipts** keep working because the server holds the keys: the inbound worker seals raw mail, inbox subjects and senders and the imported receipts under the recipient's data key (mail and receipt subkeys), and the receipt text after OCR. The address lookup keeps `local_part_hash`.

#### Account deletion (crypto-shredding)

The deletion transaction deletes the user's `data_keys` rows (every version) after their personal rows, receipts and mail. **On the live database** the data is then unrecoverable at once, including dead tuples not yet vacuumed. **In backups**, a dump or base backup taken before the deletion still holds the wrapped key, which the root key still unwraps; the shredding reaches backups when the last backup that holds that key row expires. Operators who want a shorter horizon than their ledger backups can back up `penny.data_keys` separately with a short retention (and exclude it from long-term dumps), knowing that a long-term dump without its key backup restores amounts and dates only. Household keys are never shredded by a member's deletion; a household's key goes only if its household is ever deleted.

#### Key rotation (shared with MAZ-293)

- **Root key rotation:** add `Encryption__Keys__<n+1>`, set `Encryption__ActiveKey`, restart. `rotate-keys` re-wraps every `data_keys` row (one small row per user and household) in batches; each row commits on its own, so it is interruptible and resumes where `kek_version < active` remains. Readiness reports rows still on old versions. Then the operator removes the old root key, **after the last backup that needs it expires**, since restoring an older backup needs the key version it was wrapped with. The legacy `Receipts__MasterKey` goes the same way once `rotate-keys --legacy` has re-sealed version 1 receipts, receipt names, raw mail and inbox rows under the owners' data keys.
- **Data key rotation** (suspected exposure, or on a schedule): `rotate-keys --data-keys [--user <id> | --household <id>]` creates a new version, new writes use it, and rows are re-sealed in batches by the version in their envelope; receipt files are re-encrypted (temp file, fsync, rename, then the row) as today's write order. The old version is retired and deleted when no envelope references it.
- Old versions stay readable throughout; nothing needs a write freeze. Documented in operations.md (secret rotation), replacing "not rotatable by design".

#### Key backup and loss

- The root keys are backed up in the secret manager's own backup, **never** next to the database or receipt backups (same rule as the receipt key today). Startup refuses to run when a referenced key version is missing or its check value doesn't match.
- **Losing every copy of a root key** makes every ledger text, personal amount, receipt and inbox item it wraps unreadable for good: shared amounts, dates and memberships survive, nothing else does. There is no escrow and no recovery path, by design. `keys-verify` (run by readiness and on demand) proves every data key unwraps, so a bad key is found before an old one is removed.

#### Migration, online, with rollback

1. **Release A (expand).** Add `key_versions`, `data_keys`, the nullable `sealed` and `sealed_embedding` columns and a per-household search revision. Writers seal every write **and** keep writing the plain columns; readers use `sealed` when present. `ledger-seal` (a maintenance command) seals existing rows one user or household per transaction, in the lock order of each writer, skipping rows already sealed, so it can run while the API serves traffic and resumes after interruption. `ledger-seal --verify` opens every sealed row and compares it with the plain columns. Search keeps its SQL path until a scope is fully sealed, then switches to the in-memory path; `search-verify` compares both paths' results on a sample of queries.
   **Rollback:** deploy the previous release; the plain columns are complete and the new columns are ignored.
2. **Release B (contract).** Once `--verify` is clean, `ledger-seal --finalize` blanks the plain columns in batches, and a migration then drops them with their trigram and HNSW indexes. Dead tuples are rewritten by `VACUUM (FULL)` (or `pg_repack`) of the sealed tables, as documented; backups and WAL taken before finalize still hold plaintext until they expire, and the docs say so.
   **Rollback:** recovery is forward-only ([PostgreSQL](postgresql.md#forward-only-recovery)), so the way back is `ledger-unseal`, which rewrites plain columns from the sealed ones in a later release, with the keys present.

No API contract, OpenAPI or client change is needed: the ledger, shared, search and export routes answer the same JSON. Step 2 is therefore one Linux phase, with MAZ-293's key ring, data keys and receipt text sealing first.

#### Performance

Measured with `apps/backend/development/seal-bench.cs` (.NET 10, in process, no PostgreSQL) on the synthetic ledgers of the [sync baseline](ledger-sync-baseline.md) (seed 186), on the same `worker` machine (Intel i5-4690, 2 CPUs), median of 7 runs. It seals each field separately, so the seal and open times and the sealed size are an **upper bound** for the one-envelope-per-row design.

| Entries | Fields | Plain KiB | Sealed KiB, per field | Unwrap a data key | Seal all | Open all | Search cold (open, rebuild, scan) | Search warm, per query | Trigram tokens (blind index) | Computing them | Cosine scan, top 200 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2,000 | 4,042 | 44 | 174 | 3–8 µs | 31 ms | 6 ms | 9 ms | 0.3 ms | 72,909 | 217 ms | 5 ms |
| 50,000 | 100,042 | 1,075 | 4,299 | 3 µs | 504 ms | 191 ms | 211 ms | 5 ms | 1,806,396 | 2.4 s | 7 ms |
| 100,000 | 200,042 | 2,139 | 8,586 | 3 µs | 504 ms | 230 ms | 403 ms | 5 ms | 3,601,952 | 4.2 s | 16 ms |

What that means against the baseline:

- **`GET /api/ledger`** opens every row: about +6 ms on 39 ms at 2,000 entries, about +190 ms on 625 ms at 50,000 (+15 to +30 %).
- **`PUT` of one changed entry** opens the stored rows to diff them (the same +6 / +190 ms) and seals one row; the **first full sync** seals everything (+31 ms at 2,000, about +0.5 s at 50,000, on 2.7 s). A change-based sync (ADR 005) would remove the open-everything step.
- **Search** gets faster when warm (5 ms in memory, against 40–90 ms warm p50 through the GIN indexes on the faster search benchmark host) and slower on a cache miss: 0.4 s to open and rebuild 100,000 documents, plus reading about 170 MB of sealed rows with their embeddings, which wasn't measured and is estimated at 0.5–1 s. At 2,000 entries a miss costs about 10 ms plus a few MB of reads. The cache holds about 1.7 KB per document (text plus a float32 vector): about 3 MB for a typical 2,000-entry ledger and 170 MB at 100,000, so the default 256 MB bound fits one very large ledger or many typical ones.
- **Storage:** about 33 bytes per sealed row plus padding (the per-field figure above, 4×, is the upper bound because most notes are empty). The dropped GIN and HNSW indexes give back more than that.
- **Seal cost is mostly the random nonce** (per-field sealing runs at 2.5–8 µs a field, opening at about 1–2 µs), so the backfill of a 100,000-entry ledger is CPU-cheap; its cost is the row rewrites and the vacuum.

**Revisit** the blind-index fallback if cache misses at real ledger sizes exceed the search targets (300 ms warm selective, 1 s broad), and end-to-end encryption when Penny Cloud is planned.
