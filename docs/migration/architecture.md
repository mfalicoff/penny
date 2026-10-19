# MAZ-50: migration architecture and sequence

Status: accepted baseline, 2026-10-19. This records current behavior; it does not cut over production traffic.

The detailed [current route, storage and deployment inventory](current-inventory.md) and [feature parity matrix](feature-parity.md) are part of this decision.

## ADR 001: preserve the wire and data boundary first

The current product is an Expo SDK 57 app in `src/` and a Node 24/Express 5 service in `server/`. `server/index.ts` serves the exported web bundle and the API on one origin. `Dockerfile` and `compose.yaml` build a single container; SQLite lives at `/data/penny.sqlite` in a persistent volume. The browser can use an HttpOnly `/api` cookie; native clients use a bearer token. The shared ledger is a JSON document in SQLite, with a separate integer revision. Household, receipt, session, invite, push and audit records are relational. See `server/infrastructure/database.ts` and `server/infrastructure/repositories.ts`.

The migration keeps the existing `/api` paths, JSON shapes, SQLite database and documented behavior until an explicit compatibility change is approved and tested. The .NET API owns authentication, persistence, shared households, receipts, push delivery and server-side validation. It must support existing Expo clients during coexistence. SwiftUI and TanStack clients own their presentation, local drafts and durable personal offline base/local snapshots. They do not write SQLite or calculate shared balances authoritatively.

The proposed repository layout is:

| Path | Owner |
| --- | --- |
| `server/`, `src/`, `tests/`, `e2e/` | Running legacy Node and Expo product until retirement gates pass |
| `apps/backend/` | Independently deployed ASP.NET Core API and integration tests |
| `apps/ios/` | Native Swift/SwiftUI iPhone and iPad app and XCUITest |
| `apps/web/` | Vite React/TypeScript app using TanStack Router and Query |
| `contracts/` | Versioned OpenAPI, sanitized JSON examples and parity fixtures |
| `docs/migration/` | Decisions, compatibility policy and feature-to-test matrix |

Each new app has scoped `AGENTS.md` guidance. A future build must not infer Expo rules for Swift or .NET from the legacy root guidance. Do not place new application code in `src/app/` unless it is an Expo Router screen.

## ADR 002: divide calculation ownership

Personal ledger commands, recurrence materialization and three-way field merge currently run on the client in `src/domain/ledger.ts`, `src/domain/commands.ts`, `src/data/offlineLedger.ts` and `src/providers/LedgerProvider.tsx`. The new clients implement those rules against shared golden fixtures. The .NET service validates whole-ledger writes and performs an atomic compare-and-swap, but it does not silently regenerate personal occurrences or merge conflicting client edits. A personal schedule uses the device's local calendar date; its original anchor day survives short months. The local pending value wins a same-field race, while untouched remote fields remain. A failed retry remains pending and visible.

Shared split allocation, historical membership, recurrence materialization, monthly balances, reimbursements and projections are server-owned; the current implementation is `server/infrastructure/households.ts` with pure rules in `src/domain/households.ts`. New clients render the server's shared projection alongside private ledger entries and never add a shared expense into the private ledger. Payment account IDs remain visible only to their payer. Amounts are integer cents and dates are calendar strings, not timestamps.

## ADR 003: compatibility and migration policy

The initial .NET release accepts exactly the validated legacy ledger versions 1 through 4, upgrades successful writes to version 4, and returns version 4 snapshots. The existing Node service blocks pre-v3 writes when payment accounts exist; the replacement must retain this guard. An older client that cannot safely round-trip v4 data must be asked to upgrade before a write. No arbitrary minimum app version is inferred from the current API, which sends no client-version header. Introduce an explicit client capability/version signal and a documented `426` response only in a later coordinated issue; until then, use the present `400` error envelope for unsafe old writes. Keep v4, revision and wire fields stable during coexistence.

Keep the legacy server as the only active SQLite writer until the rehearsed backend cutover (MAZ-65). Back up the database including WAL state, migrate a copy, verify legacy-client reads and writes, and plan rollback with post-cutover writes accounted for. Do not claim a simple file restore can preserve writes made after cutover. The iOS upgrade path (MAZ-72) and browser storage migration (MAZ-87) must preserve unsynced base/local snapshots before retiring Expo. Android and Expo mobile retirement waits for MAZ-98; web retirement waits for MAZ-97.

## Execution sequence and gates

1. MAZ-50 establishes this contract and the parity matrix.
2. MAZ-51 and MAZ-62 build the .NET foundation and shared fixture harness. MAZ-66 and MAZ-83 can begin after contract agreement; issue relations govern subsequent order.
3. Port backend capabilities behind compatibility tests, then rehearse MAZ-65 with one writer and rollback evidence.
4. Implement Swift and web features and offline migration. Run native simulator, real API/SQLite browser and cross-client journeys.
5. Release web and native clients only after the data-upgrade, accessibility, physical-device and rollback gates in the project roadmap.

The current checks can prove contract and Node behavior. They cannot establish .NET, Swift, multi-browser, APNs transport or in-place upgrade behavior before those implementations exist.

## Source inventory

| Concern | Source of truth | Existing tests |
| --- | --- | --- |
| HTTP routes and auth | `server/app.ts`, `server/http/`, `server/application/oidc.ts` | `tests/server.test.ts`, `tests/server-boundaries.test.ts`, `tests/oidc.test.ts` |
| SQLite format and atomic revisions | `server/infrastructure/database.ts`, `server/infrastructure/repositories.ts` | `tests/server.test.ts`, `tests/households-server.test.ts` |
| Personal ledger v1–v4, money, recurrence | `src/domain/ledger.ts`, `src/domain/commands.ts` | `tests/model.test.ts`, `tests/accounts.test.ts`, `tests/trips.test.ts`, `tests/investments.test.ts` |
| Offline personal base/local | `src/data/offlineLedger.ts`, `src/providers/LedgerProvider.tsx` | `src/data/__tests__/offlineLedger.test.ts`, `src/providers/__tests__/LedgerProvider.test.tsx` |
| Shared splits and privacy | `src/domain/households.ts`, `server/infrastructure/households.ts` | `tests/households-domain.test.ts`, `tests/households-server.test.ts` |
| Receipts, push and widgets | `server/application/receipts.ts`, `server/application/push.ts`, `src/widgets/` | `tests/server.test.ts`, `tests/push-server.test.ts`, `src/widgets/__tests__/` |
| Deployment | `Dockerfile`, `compose.yaml`, `.github/workflows/` | `npm run build:web`, CI checks and Playwright `e2e/` |
