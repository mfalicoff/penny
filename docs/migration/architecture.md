# MAZ-50: migration architecture and sequence

Accepted revision: 2026-11-07. This specifies v2; it does not deploy replacement services. The October 19 verification in Linear describes the earlier SQLite baseline only. This revision supersedes its server storage decision.

## ADR 001: preserve the public boundary; migrate server storage

The running baseline is Expo SDK 57 (`src/`) and Node 24/Express (`server/`), with a same-origin exported web bundle and SQLite. (MAZ-97 and MAZ-98 later retired the Expo web and mobile apps; `src/` now holds only the shared rules in `src/domain/`.) **PostgreSQL is the committed v2 server database.** SQLite is the legacy import and rollback source. Device/browser durable stores remain local; they never connect to PostgreSQL.

Preserve `/api` paths, camelCase JSON, ledger v4, arbitrary existing string IDs, integer revisions, session hashes/expiry, receipt IDs/bytes and shared visibility during coexistence. JSON key order is not a contract; array order and absent/null distinctions are. Search v1 is additive, defined in [search.md](search.md). Legacy scrypt password hashes are deliberately not verified by the .NET backend; those accounts must reset their password with an operator-issued code ([password reset](authentication.md#password-reset-maz-123)).

| Path | Ownership |
| --- | --- |
| `server/`, `src/domain/`, `tests/` | Legacy Node API (rollback image), shared TypeScript rules and their regression suites; the Expo app was removed in MAZ-98 |
| `apps/backend/` | Independent ASP.NET Core API, application/domain ports, PostgreSQL persistence and integration tests |
| `apps/ios/` | Swift/SwiftUI iPhone/iPad presentation, domain rules, durable local data and XCUITest |
| `apps/web/` | React/TypeScript, TanStack Router/Query, accessible DOM and durable browser data |
| `contracts/` | OpenAPI, sanitized fixtures and design trace snapshot for all stacks |
| `docs/migration/` | Decisions, compatibility, import/cutover and acceptance gates |

Scoped `AGENTS.md` files distinguish new stacks from root legacy guidance. PostgreSQL major 18 is selected; MAZ-51/52 pin compatible .NET/Npgsql versions, PostgreSQL patch and image digest before implementation. No database/provider binaries are added by this specification.

## ADR 002: calculation and conflict ownership

Personal commands, recurrence materialization and three-way merge remain client-owned (`src/domain/ledger.ts`, `commands.ts`, `merge.ts`; in the Expo app also `src/data/offlineLedger.ts` and `LedgerProvider.tsx`, removed in MAZ-98). Save `{base,local}` durably before acknowledging a personal save. Generate IDs once, serialize saves and refetch/merge/retry 409s. Local edited fields win same-field races; untouched remote fields survive. Local deletions remove entries; locally edited remotely deleted entries can reappear under the existing algorithm. Preserve failed pending work. The API validates whole-ledger writes and atomically compares/increments revisions; it never silently merges or generates personal recurrence. Personal recurrence uses the local calendar and preserves anchor days.

Shared allocation, historical membership, recurrence, monthly settlement, reimbursements and personal projections remain server-owned (`src/domain/households.ts`, `server/infrastructure/households.ts`). Project shared expenses exactly once; do not insert them into private ledgers. Only the payer sees their private account reference. Recorded `transactions` and month-only `scheduled` previews remain separate. Home labels expected income; Activity, spending and widgets use recorded entries. Reimbursements record existing payments, never move money or create spending. All stacks use integer cents, basis points and date-only calendar strings.

## ADR 003: compatibility and client migration

Accept validated ledger v1–v4, normalize to v4, return `{revision,ledger}` and retain the pre-v3 write guard when payment accounts exist. Unsafe old writes retain 400. No client-version header/minimum build exists today; do not invent a 426 gate for existing routes. Future incompatible changes require negotiated capabilities and coordinated clients. Tolerate additive response fields; never save unknown ledger versions destructively. `/api/info` remains public `{name:"penny",version}` for credential-free signed-out server verification.

MAZ-72 proves in-place iOS migration of SecureStore/AsyncStorage/App Group data or delivers a tested bridge release; MAZ-87 preserves browser pending snapshots and cookie/origin scope. Retain source data until validated; a reminder to sync is insufficient. Preserve server namespaces, including original unscoped keys. Never send credentials to a candidate server. Device-local biometric lock conceals dialogs/content on inactive/background transitions, fails closed on preference read failure and preserves drafts. Web omits lock/server selection.

## ADR 004: redesign and platform scope

The iOS-native redesign ([docs/design/penny-ios](../design/penny-ios/README.md), 61 cards, and the 42-component [design-kit](../../design-kit/package.json), synced to the [Penny Claude Design project](https://claude.ai/design/p/173b576e-aa32-44dc-9f83-23f0ea8df538)) is the visual and interaction baseline, traced in [design-baseline.json](../../contracts/design-baseline.json) and [redesign.md](redesign.md). On iPhone, Home / Activity / Shared / Trips tabs and a separate add button replace More; Recurring, Accounts, Categories and Settings open in a Settings sheet, and every legacy deep link keeps a destination. Light and dark follow the system; SF Pro and SF Symbols on iOS, Inter and Ionicons on the web. Native iOS 26 Liquid Glass is required on the control layer, with explicit OS and accessibility adaptations. There is no Android baseline; MAZ-98 retires Android.

MAZ-132 re-baselined the contract on these cards; MAZ-122 owns the visual comparison of implementations against them. The contract records card and source hashes, every card and control owner and acceptance scenario; it does not assert any implementation matches. MAZ-69/85 own controls; MAZ-82/96 own visual/functional release gates.

## Execution sequence and gates

1. MAZ-50 restores/updates earlier contracts against current `master`, records PostgreSQL/search/design decisions and runs legacy checks. Historical verification stays historical.
2. MAZ-51/52 provision PostgreSQL and explicit import/migrations; MAZ-62 supplies real PostgreSQL fixtures. MAZ-121 builds search after the atomic projection boundary exists. MAZ-122 versions/finalizes design before implementation relies on local-only assets. MAZ-66/83 establish separate clients.
3. MAZ-53–61 port auth, ledger, shared features, receipts and transport. Compare old Node/SQLite and new .NET/PostgreSQL against the same contracts. Test extension privilege failure, concurrency, worker restart and search isolation using [postgresql.md](postgresql.md).
4. MAZ-64/65 rehearse cutover with frozen SQLite writes, verified counts/checksums/revisions and existing Expo clients. Only one service/database accepts writes. Rollback to SQLite is possible only before writes reopen; afterwards recovery is forward-only (PostgreSQL PITR plus receipt-root backups). See [PostgreSQL contract](postgresql.md#cutover-and-forward-only-recovery).
5. MAZ-67–80 and 84–94 implement clients and durable migration; MAZ-81/82 and 95/96 run simulator/browser/cross-client/accessibility gates. MAZ-97/98 release/retire only after pending-data, TestFlight, physical-device and rollback proof.

See [inventory](current-inventory.md), [parity](feature-parity.md), [API reference](api-reference.md) and [verification](verification.md). Specification tests do not prove future .NET/Swift/TanStack, PostgreSQL execution plans, native materials or upgrades.
