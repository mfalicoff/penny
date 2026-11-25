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
