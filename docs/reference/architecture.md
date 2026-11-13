# Architecture decisions

These decisions (MAZ-50, accepted 2026-11-07) still shape v2: the native iOS app, the web app and the .NET API on PostgreSQL.

## ADR 001: preserve the public boundary; PostgreSQL storage

**PostgreSQL 18 is the server database.** Device and browser durable stores remain local; they never connect to PostgreSQL.

The API keeps `/api` paths, camelCase JSON, ledger v4, arbitrary existing string IDs, integer revisions, session hashes/expiry, receipt IDs/bytes and shared visibility. JSON key order is not a contract; array order and absent/null distinctions are. Search v1 is additive, defined in [search.md](search.md).

| Path | Ownership |
| --- | --- |
| `src/domain/`, `tests/` | Shared TypeScript rules, golden fixture generator and their regression suites |
| `apps/backend/` | ASP.NET Core API, application/domain ports, PostgreSQL persistence and integration tests |
| `apps/ios/` | Swift/SwiftUI iPhone/iPad presentation, domain rules, durable local data and XCUITest |
| `apps/web/` | React/TypeScript, TanStack Router/Query, accessible DOM and durable browser data |
| `contracts/` | OpenAPI, sanitized fixtures and design trace snapshot for all stacks |
| `docs/migration/` | Decisions and per-feature reference for the API |

## ADR 002: calculation and conflict ownership

Personal commands, recurrence materialization and three-way merge are client-owned (`src/domain/ledger.ts`, `commands.ts`, `merge.ts` and their Swift ports). Save `{base,local}` durably before acknowledging a personal save. Generate IDs once, serialize saves and refetch/merge/retry 409s. Local edited fields win same-field races; untouched remote fields survive. Local deletions remove entries; locally edited remotely deleted entries can reappear under the existing algorithm. Preserve failed pending work. The API validates whole-ledger writes and atomically compares/increments revisions; it never silently merges or generates personal recurrence. Personal recurrence uses the local calendar and preserves anchor days.

Shared allocation, historical membership, recurrence, monthly settlement, reimbursements and personal projections are server-owned (`src/domain/households.ts` is the TypeScript reference for the split and settlement rules). Project shared expenses exactly once; do not insert them into private ledgers. Only the payer sees their private account reference. Recorded `transactions` and month-only `scheduled` previews remain separate. Home labels expected income; Activity, spending and widgets use recorded entries. Reimbursements record existing payments, never move money or create spending. All stacks use integer cents, basis points and date-only calendar strings.

## ADR 003: versioning

Accept validated v4 ledgers only and return `{revision,ledger}`; any other version gets 400. There is no client-version header or minimum build; do not invent a 426 gate for existing routes. Future incompatible changes require negotiated capabilities and coordinated clients. Tolerate additive response fields; never save unknown ledger versions destructively. `/api/info` remains public `{name:"penny",version}` for credential-free signed-out server verification.

Never send credentials to a candidate server. Device-local biometric lock conceals dialogs/content on inactive/background transitions, fails closed on preference read failure and preserves drafts. Web omits lock/server selection.

## ADR 004: redesign and platform scope

The iOS-native redesign ([docs/design/penny-ios](../design/penny-ios/README.md), 61 cards, and the 42-component [design-kit](../../design-kit/package.json), synced to the [Penny Claude Design project](https://claude.ai/design/p/173b576e-aa32-44dc-9f83-23f0ea8df538)) is the visual and interaction baseline, traced in [design-baseline.json](../../contracts/design-baseline.json) and [redesign.md](redesign.md). On iPhone, Home / Activity / Shared / Trips tabs and a separate add button replace More; Recurring, Accounts, Categories and Settings open in a Settings sheet, and every route keeps a destination (`navigation.routes` in the baseline). Light and dark follow the system; SF Pro and SF Symbols on iOS, Inter and Ionicons on the web. Native iOS 26 Liquid Glass is required on the control layer, with explicit OS and accessibility adaptations. There is no Android app.

MAZ-132 re-baselined the contract on these cards. The contract records card and source hashes, every card and control owner and acceptance scenario. MAZ-122 added the light and dark baselines and the per-card verdicts for the iOS and web apps (`contracts/visual-comparisons.json`, [visual acceptance](../design/visual-acceptance.md)). MAZ-69/85 own controls; MAZ-82/96 own visual/functional release gates.

See the [API reference](api-reference.md) and the [PostgreSQL contract](postgresql.md).
