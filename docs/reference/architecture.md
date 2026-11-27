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

**Status:** proposed, for the owner's review (MAZ-295, with the key infrastructure of MAZ-293). The owner chose option 1 with the search design below (2026-11-26); the decisions still open are listed at the end. Nothing is built yet.

**Context.** Every ledger row is plaintext in PostgreSQL: entry, rule and shared expense titles, notes and categories, account and trip names, household names, the normalized search texts and their embeddings (`search_documents`), receipt text and its chunks (`receipt_texts`, `receipt_text_chunks`) and the household audit snapshots (`household_audit.before_json`, `after_json`). Anyone who gets a `pg_dump`, a base backup, the WAL archive, the volume or database credentials reads every ledger. Only receipt files and names, inbound mail, receipt inbox subjects and senders and receipt mail addresses are sealed today, all with keys derived from the one never-rotated `Receipts__MasterKey` (`ReceiptFileStore`, `InboundMailSealer`).

What the code relies on, which limits what can be sealed:

- **Text is only used in SQL by search.** Ledger reads order by id and date ([ledger](ledger.md#storage-mapping-and-read-order)); no query filters, sorts or joins on a title, note or name. The only SQL over text is search: `LIKE` and `pg_trgm` `<%` on `search_documents.{title_text, document_text, owner_text}` and `receipt_texts.search_text`, and pgvector HNSW on the embeddings (`PostgresSearchRepository`). Validation runs in C# on the parsed document. Text length checks (`ck_*_title`, `ck_*_note`, `ck_*_name`) duplicate the API's validation.
- **Shared amounts are summed in SQL.** Monthly balances and recaps group and sum `household_expenses.total_cents`, `household_splits.amount_cents` and `household_reimbursements.amount_cents` under the household lock (`PostgresHouseholdTransaction`). Personal amounts are only read back and projected; search sorts by `search_documents.amount_cents`.
- **Shared rows outlive their members.** Account deletion (MAZ-152, `PostgresAccountDeletionRepository`) keeps the person's shared expenses, splits and payments, strips their account names and receipts from them, and deletes every personal row.
- **The audit checks JSON in SQL.** `ck_household_audit_before_private` and `ck_household_audit_after_private` reject snapshots carrying `accountId` or `receipt.name`.
- **Emailed receipts arrive without the person.** The inbound worker seals and parses mail and runs OCR with nobody signed in.
- **The devices already hold most of what is searched.** iOS and the browser keep the whole personal ledger for offline use ([native offline sync](../ios/offline-sync.md), [browser offline sync](../web/offline-sync.md)) and already search it locally (tiers 1–2). Both download each household's full expense list (`GET /api/households/{id}/expenses`, `apps/web/src/api/households.ts`). Receipt text is the only searchable data that stays on the server.

### Threats

| Threat | 1. Server-side field encryption, per-user keys | 2. End-to-end encryption | 3. Disk encryption or TDE only |
| --- | --- | --- | --- |
| Stolen `pg_dump`, base backup or WAL archive | **Protected** (text and personal amounts), if the key isn't stored with the backup | Protected | **Not protected**: a dump is logical, so it's plaintext; WAL archives too unless the archive is encrypted |
| Stolen disk, volume or VM snapshot | Protected | Protected | Protected (volume) / protected (TDE) |
| Database administrator (SQL access, no API secrets) | **Text protected.** Sees amounts, dates, counts, ids and lengths; can delete rows or replay a row's older ciphertext (AAD stops moving ciphertext between rows, users or columns) | Protected, same metadata | Not protected |
| Compromised running API or its host | **Not protected**: it holds the keys, sees the plaintext of every save and the text of every search query, and decrypts on demand | Content protected from iOS; **not** from the web app, which the compromised server serves | Not protected |
| Operator holding the secrets | Not protected (on a self-hosted install the operator is usually the user) | Protected | Not protected |
| **Cost** | Medium to large: one key service, sealed columns, an online migration, and search moved to the devices (shared rules, a fixture, Swift and web), plus blind indexes for receipt text. A contract change: vectors travel to the devices, and a query embedding route | Very large: server-side search, OCR, emailed receipts, ledger validation and settlement over amounts all move to the clients or stop working; household key exchange and device recovery; lost devices lose data. Penny Cloud-sized | Small: documentation, plus a forked PostgreSQL for TDE (community PostgreSQL 18 has none, and the pinned `pgvector/pgvector` image would have to change) |

### Decision

**Option 1, server-side field encryption with per-user and per-household keys**, plus encrypted volumes and encrypted backup storage as the documented baseline (option 3 as defense in depth, not as the protection). It protects what the audit found (dumps, backups, disks and database access) without changing settlement or emailed receipts. Search moves to the devices for everything they already hold (personal entries and household expenses); only receipt text is searched on the server, through blind indexes. End-to-end encryption stays out of scope until Penny Cloud.

**Threat model.** This protects a stolen dump, backup, WAL archive, disk or volume, and a database administrator without the API's secrets. It does **not** protect against a compromised running API: the server still sees the plaintext of every save (it validates, embeds and seals it) and the text of every search query (it embeds the query and matches receipt text), and it holds the keys.

#### Key hierarchy

```text
root key v1, v2, …            operator secret (Encryption__Keys__<n>), versioned; never in PostgreSQL or stateDir
  └─ KEK_n = HKDF(root_n, info "penny/kek/v1")
       └─ wraps (AES-256-GCM) each data key row in penny.data_keys
            ├─ user data key (one per user, versioned)
            │    ├─ HKDF info "penny/field/v1"         ledger rows and their sealed vectors
            │    ├─ HKDF info "penny/receipt/v2"        receipt files, names, receipt text and its vectors (MAZ-293)
            │    ├─ HKDF info "penny/receipt-index/v1"  blind index tokens of receipt text
            │    └─ HKDF info "penny/inbound-mail/v2"   raw mail, inbox subject and sender, receipt address (MAZ-293)
            └─ household data key (one per household, versioned)
                 └─ HKDF info "penny/field/v1"          shared expenses and rules, household name, audit, shared expense vectors
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
| `search_documents` | `embedding` (into `sealed_embedding`, under the user's or household's key); `title_text`, `document_text`, `owner_text`, `embedding_source` and `amount_cents` are **dropped**, because the devices search the text | keys, scope, `kind`, `item_date`, `receipt_id`, `content_hash`, model and outbox columns | The embedding outbox, and which vectors each device still needs |
| `receipt_texts`, `receipt_text_chunks` (MAZ-293) | `content`, `search_text`, `passage`, `embedding` (into `sealed_embedding`) | status, method, engine, pages, outbox columns, and the blind index `index_tokens int2[]` | Extraction outbox; the tokens are already keyed hashes |
| `receipts`, `receipt_inbox_items`, `receipt_mail_addresses`, `inbound_messages` | already sealed; re-sealed under the owner's data key (`encryption_version` 2) | `local_part_hash`, sizes, MIME types, statuses | The address lookup uses the hash |

**Amounts.** Personal amounts are proposed sealed (an open decision): nothing in SQL computes with them, so the only cost is moving their check constraints into the writer. Search doesn't need them on the server any more, because the devices sort by amount over the ledger they hold. Shared amounts stay plain: sealing them would move monthly balances, recaps and reimbursement checks out of SQL and out of the household lock, for metadata the database administrator still mostly infers from splits and reimbursements. **What a dump still shows:** for each user, how many entries and rules exist, their dates, kinds, category, account and trip ids, colors and account types; for each household, every shared amount, date, payer and split, every reimbursement, and who did what when in the audit. Ids are chosen by the clients (the web's `uid()` is random), but legacy and default ids such as a category called `groceries` still say what they are.

**Out of scope, still plain:** `users.email` and `household_email_invites.email` (sign-in and invitation lookup; a keyed blind index could replace them later), `users.display_name` and `user_avatars` (profile, shown to household members, cleared on deletion), session, invite and reset hashes, and the outboxes (`push_outbox` payloads hold ids only, and `PushContent` is generic per event type).

#### Search

Search moves to where the readable data already is. The [search v1](search.md) rules stay the same: normalization, tiers, thresholds, relevance order and access. Only where they run changes.

| What is searched | Where | Over what | Tiers |
| --- | --- | --- | --- |
| Personal entries | On the device (iPhone, iPad, browser) | The ledger each already holds for offline use | 1–3 offline and online; 4 online |
| Household expenses | On the device | Each household's expense list (`GET /api/households/{id}/expenses`), as both apps already load it | 1–3 over what is loaded; 4 online |
| Receipt OCR text | On the server | Blind indexes, then the sealed text and vectors of the receipts the viewer may read | 2–4 |

**1. Personal entries, on the device.**

- **Shared rules first.** `apps/web/src/domain/search.ts` gets the whole matcher: the normalization of search v1 (today a test-only reference in `apps/web/tests/domain/search-normalization.ts`), tiers 1–3 with a TypeScript port of `pg_trgm`'s `word_similarity` at the same 0.6 threshold, the tier 4 threshold rule (`MeaningThreshold`: at least 0.82 and 0.015 above the query's baseline), and the relevance order (tier, score rounded to 6 decimals, date, key; or amount, date, key). It stays pure TypeScript, like the rest of `src/domain`.
- **A golden fixture.** `contracts/fixtures/search-cases.json` gains typo cases (`word_similarity` scores pinned to 6 decimals) and ranking cases, generated by `fixtures:generate`. While the server path still exists, a .NET test checks the fixture's typo scores against PostgreSQL's `word_similarity`, so the port matches the behaviour that was tuned. Meaning cases pin a query vector, document vectors and the expected matches, so the threshold rule is checked without the model.
- **Then Swift and web.** `PennyDomain` (`SearchText.swift`, `LocalSearch.swift`) and the web app implement the same rules against the fixture, replacing today's tiers 1–2 local search (the web's `searchMatcher`, which doesn't fold accents yet). Activity keeps its screens; "On this device" stops being a special mode, because every result now comes from the device.
- **Pagination** becomes local: the device sorts the full match list and pages it in memory, so the cursor format of search v1 goes away for entries and expenses.

**2. Household expenses, on the device.** Both apps already download each household's full expense list, with the viewer's share and the membership-period rules applied by the server, so access stays a server rule: a device can only search what the server sent it. The payer's account name is in the list only for the payer, as today. The rows are sealed with the household key in the database and opened by the server when it serves the list. The limits:

- Search covers what is loaded. Online, the app fetches the lists it doesn't have yet; offline, only lists already cached are searched (the browser doesn't cache them durably yet, [browser offline sync](../web/offline-sync.md#search)).
- Searching across every household means fetching each household's list. That is one request per household, cached by the existing household queries. It is fine for a few households; a person in many large households pays for each list once per session.
- A former member sees only what the list already shows them; revoked access disappears when the list is refetched.

**3. Receipt OCR text, on the server, through blind indexes.** Receipt text is the only searchable data the devices don't hold (downloading every receipt's text to every device would be far larger than the ledger). The server keeps a blind index per receipt:

- **Tokens.** The receipt's normalized text is cut into the same trigrams `pg_trgm` uses. Each trigram becomes `HMAC-SHA256(receipt-index key, trigram)` cut to its first **12 bits**. The set is stored in `receipt_texts.index_tokens int2[]` with a GIN index.
- **Keys per user.** The index key is derived from the receipt owner's data key (`penny/receipt-index/v1`), so the same word gives different tokens in two people's receipts, and frequencies can't be pooled across users. For a query, the server computes the query's tokens once per receipt owner whose receipts the viewer may read: the viewer, plus the payers of shared expenses in their households, which is a handful of keys.
- **Short tokens collide.** 12 bits gives 4,096 buckets for tens of thousands of distinct trigrams, so each token stands for several trigrams. That blurs frequency analysis, at the cost of more false candidates.
- **Candidates are checked after decryption.** Tier 2 asks for receipts holding every token of the query (`index_tokens @> query_tokens`), and tier 3 for those sharing enough of them. The server opens the candidates' sealed text and applies the real substring and `word_similarity` tests, so a collision never becomes a result. The receipt download rule ([receipts](receipts.md#access)) runs in the same SQL statement, before candidates are opened, as today.
- **Results** are receipt matches (the entry or expense key, tier and score). The device merges them into its own results with the same relevance order. A viewer who can see a shared expense but not its receipt never matches it through the receipt, as today.
- **The remaining leak.** A dump holder sees, per receipt owner: how many distinct trigram buckets each receipt has (a rough text length), which receipts share buckets (similar receipts look similar, and two copies of the same receipt look equal), and how often each bucket appears across that person's receipts. With a known plaintext for that person (a receipt they also hold, from a common shop), they can learn some of that person's buckets and guess at others' contents. Truncation means a bucket never names one trigram. Nothing is pooled across users, and the receipt text itself stays sealed.

**4. Meaning (vector) search.**

- **The server still makes the vectors**, with `multilingual-e5-small` (384 dimensions, `OnnxTextEmbedder`), from the plaintext it already has at save time: entries, shared expenses, and receipt chunks after OCR. The embedding outbox stays; its worker opens the sealed row, embeds it and seals the vector under the user's or household's key (`search_documents.sealed_embedding`, `receipt_text_chunks.sealed_embedding`). A new or edited entry gets its vector within seconds, as today; until then it is found by tiers 1–3.
- **The vectors travel to the devices.** The server opens them when a device syncs, like the rest of the row, and sends them over TLS. They don't go inside `GET /api/ledger` or the household expense list, which would grow by about 1 KB per entry: a separate route, `GET /api/ledger/vectors` and `GET /api/households/{id}/vectors`, returns int8 vectors with a per-vector scale (388 bytes each) for the keys whose `content_hash` and model version the device doesn't have yet. The device stores them next to its ledger: in the iOS app's protected store, and in the browser's IndexedDB, both of which already hold the ledger in the clear.
- **For a query**, the device asks `POST /api/search/embed` for the query's vector and baseline. The server embeds the normalized query and returns it; it **stores and logs nothing** about the query (no text, no vector, no hash in logs or traces, only a request count and duration).
- **The device compares by brute-force cosine** over every loaded vector, applies the threshold rule from the shared rules and keeps the 200 closest, as today.
- **Offline**, tiers 1–3 work and meaning search doesn't, because it needs the query embedded. An on-device model (about 120 MB as Core ML or WebAssembly) would remove that; it is a later option, not this plan.
- **Receipt vectors** stay on the server: for a query, it opens the sealed chunk vectors of the receipts the viewer may read and compares them with the query vector, with no index. That is a few chunks per receipt; at 1,000 receipts about 5,000 vectors, a few milliseconds to open and compare.
- **The pgvector HNSW indexes and every readable vector go away.** pgvector stays only if something else needs it; otherwise the database image can return to plain PostgreSQL in a later release.

**Device cost**, measured on `worker` (Intel i5-4690, a 2014 desktop CPU with AVX2), median of 15 to 21 runs, 384-dimension vectors, a full scan plus the threshold filter and top 200:

| Entries | Vectors held, float32 | Vectors held, int8 | Scan, plain JavaScript (Node 24) | Scan, SIMD (.NET `Vector<T>`, float32) | Scan, SIMD (int8) |
| --- | --- | --- | --- | --- | --- |
| 2,000 | 3.1 MB | 0.8 MB | 1.1–1.3 ms | 0.15 ms | 0.10 ms |
| 50,000 | 77 MB | 19 MB | 24–33 ms | 5.2 ms | 2.6 ms |

SIMD stands in for Accelerate (`vDSP`) on iOS and WebAssembly SIMD in the browser; recent iPhones are faster than this CPU. So a typical 2,000-entry ledger costs about 1 MB of vectors and under 1 ms on iOS, and about 1 ms in plain JavaScript. A 50,000-entry ledger costs about 19 MB and 3 to 5 ms with SIMD, or about 30 ms in plain JavaScript, which is still well under the search targets; the browser can move to a WebAssembly SIMD kernel if large ledgers need it. Quantizing the document vectors to int8 (the query stays float32) changed cosine by 0.00025 on average and 0.0014 at most on synthetic vectors, inside the 0.002 margin of the binding "beverage" → "Coffee beans" fixture but close to it, so the meaning fixtures must pass with int8 vectors before int8 is used; otherwise the vectors travel as float32 (1.5 KB each). The scan was measured with a one-off harness, not committed.

**Rejected alternatives:**

- **In-memory search on the server over sealed rows** (the first draft of this ADR): decrypt each scope's documents into a bounded cache in the API and match there. It doesn't scale: the cache is per instance, so several instances each hold and warm their own; a cold instance or a cache miss pays to read and open a whole ledger (about 0.4 s plus the reads at 100,000 entries); and one large account can evict many others from a shared bound. Kept here only as the alternative considered.
- **Blind indexes for everything** (personal and shared text too). It keeps search in PostgreSQL, but it leaks token frequencies for all ledger text, not only receipts, when the devices already hold that text.
- **Keeping embeddings plain.** Embedding inversion recovers much of a short text such as an entry title, so a plain vector next to a sealed title would undo the sealing.
- **A readable search index as a temporary step.** Leaves the main leak in place.

#### Households, settlement and the audit

- Shared expenses, rules, the household name and the shared expense vectors are sealed under the household key. The server opens them when it serves the household's expense list, which is what the devices search. The payer's account name reaches only the payer's list, as today, and is never embedded.
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

Search moves to the devices before the server stops searching plain text, so the rollout has three stages:

1. **Release A, server (expand).** Add `key_versions`, `data_keys`, the nullable `sealed` and `sealed_embedding` columns and `receipt_texts.index_tokens`. Writers seal every write **and** keep writing the plain columns; readers use `sealed` when present. `ledger-seal` (a maintenance command) seals existing rows one user or household per transaction, in the lock order of each writer, skipping rows already sealed, so it can run while the API serves traffic and resumes after interruption. `ledger-seal --verify` opens every sealed row and compares it with the plain columns. The new routes ship (`GET /api/ledger/vectors`, `GET /api/households/{id}/vectors`, `POST /api/search/embed`, and receipt-only matching), and `POST /api/search` keeps its SQL path for clients that don't search on the device yet. `search-verify` compares the blind-index receipt path with the SQL path on a sample of queries.
   **Rollback:** deploy the previous release; the plain columns are complete and the new columns and routes are ignored.
2. **Clients (device search).** The shared rules and fixture land first, then the web app and the iOS app (through TestFlight) search on the device and call the server only to embed queries and match receipt text.
   **Rollback:** the old clients still work against Release A.
3. **Release B, server (contract).** Once `--verify` is clean and the supported iOS builds search on the device, `POST /api/search` answers receipt matches only, `ledger-seal --finalize` blanks the plain columns in batches, and a migration drops them with their trigram and HNSW indexes and the readable vectors. Older iOS builds then fall back to their local tiers 1–2. Dead tuples are rewritten by `VACUUM (FULL)` (or `pg_repack`) of the sealed tables, as documented; backups and WAL taken before finalize still hold plaintext until they expire, and the docs say so.
   **Rollback:** recovery is forward-only ([PostgreSQL](postgresql.md#forward-only-recovery)), so the way back is `ledger-unseal`, which rewrites plain columns from the sealed ones in a later release, with the keys present.

**This is a contract change** (OpenAPI and a minor contract version): the vector routes, the embed route, receipt-only search results and the search fixture. Step 2 is therefore two-phase: the server, contract, shared rules and web on Linux (with MAZ-293's key ring, data keys and receipt text sealing first), then the Swift search on the Mac.

#### Performance

Measured with `apps/backend/development/seal-bench.cs` (.NET 10, in process, no PostgreSQL) on the synthetic ledgers of the [sync baseline](ledger-sync-baseline.md) (seed 186), on the same `worker` machine (Intel i5-4690, 2 CPUs), median of 7 runs. It seals each field separately, so the seal and open times and the sealed size are an **upper bound** for the one-envelope-per-row design.

| Entries | Fields | Plain KiB | Sealed KiB, per field | Unwrap a data key | Seal all | Open all | Trigram tokens (blind index) | Computing them |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2,000 | 4,042 | 44 | 174 | 3–8 µs | 31 ms | 6 ms | 72,909 | 217 ms |
| 50,000 | 100,042 | 1,075 | 4,299 | 3 µs | 504 ms | 191 ms | 1,806,396 | 2.4 s |
| 100,000 | 200,042 | 2,139 | 8,586 | 3 µs | 504 ms | 230 ms | 3,601,952 | 4.2 s |

The benchmark also measures the in-memory server search of the rejected first draft; those columns are left out here. The device's cosine scan is measured in [Search](#search).

What that means against the baseline:

- **`GET /api/ledger`** opens every row: about +6 ms on 39 ms at 2,000 entries, about +190 ms on 625 ms at 50,000 (+15 to +30 %).
- **`PUT` of one changed entry** opens the stored rows to diff them (the same +6 / +190 ms) and seals one row; the **first full sync** seals everything (+31 ms at 2,000, about +0.5 s at 50,000, on 2.7 s). A change-based sync (ADR 005) would remove the open-everything step.
- **Search** runs on the device for entries and expenses: about 1 ms for the cosine scan at 2,000 entries and the text tiers over a ledger already in memory, plus one round trip to embed the query. The server's share is the embed call (one e5-small inference) and receipt matching. The blind-index tokens were measured on ledger text: about 36 per entry, so a receipt of a few hundred characters gives a few hundred tokens, computed once at OCR time.
- **Sync** sends vectors only for changed keys: about 0.8 MB (int8) the first time for a 2,000-entry ledger, 19 MB at 50,000, then a few hundred bytes per edit.
- **Storage:** about 33 bytes per sealed row plus padding (the per-field figure above, 4×, is the upper bound because most notes are empty). The dropped text columns and their GIN and HNSW indexes give back more than that.
- **Seal cost is mostly the random nonce** (per-field sealing runs at 2.5–8 µs a field, opening at about 1–2 µs), so the backfill of a 100,000-entry ledger is CPU-cheap; its cost is the row rewrites and the vacuum.

**Revisit** an on-device embedding model if offline meaning search matters, a WebAssembly SIMD scan if browser searches on very large ledgers exceed the targets (300 ms selective, 1 s broad), and end-to-end encryption when Penny Cloud is planned. Device-side search is also a step toward it: only receipt text and query embedding still need the server.

#### Open decisions for the owner

- **Personal amounts:** sealed (proposed) or plain. Sealing breaks nothing now that search sorts on the device; plain keeps the check constraints in SQL.
- **Audit retention:** 24 months (proposed), or another default.
- **Backups of deleted accounts:** how long backups may keep a deleted account's wrapped key (the crypto-shredding horizon), and whether to document a separate `data_keys` backup with a short retention.
