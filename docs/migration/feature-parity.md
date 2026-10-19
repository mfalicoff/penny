# Feature and test traceability

Baseline: 2026-10-19, `master` at `4ea5e8c`. Current implementation is the observable contract. The issue numbers identify delivery work; the proposed gates do not claim those stacks exist yet.

| Feature | Current source and test | Migration issue and required parity gate |
| --- | --- | --- |
| Password and OIDC, sessions, demo | `server/http/auth.ts`, `src/features/auth/`; `tests/server-boundaries.test.ts`, `tests/oidc.test.ts`, `e2e/auth-and-navigation.spec.ts` | MAZ-53/54, 68, 84; same login/callback and account isolation across clients |
| Personal ledger v1–v4, accounts, categories | `src/domain/ledger.ts`, `src/domain/commands.ts`; `tests/model.test.ts`, `tests/accounts.test.ts`, `tests/commands.test.ts` | MAZ-55, 70, 73/74, 86, 88/89; shared golden fixtures and legacy read/write |
| Personal trips and investment entries | `src/domain/ledger.ts`, `src/features/trips/`; `tests/trips.test.ts`, `tests/investments.test.ts`, `e2e/accounts-trips-categories.spec.ts` | MAZ-70, 73/76, 86, 88/93; no lost private history |
| Personal recurrence, historical occurrences | `src/domain/ledger.ts`, `src/features/recurring/`; `tests/model.test.ts`, `e2e/recurring.spec.ts` | MAZ-70/74, 86/90; local-date catch-up, anchor days, pause and deletion |
| Durable personal offline sync and conflicts | `src/data/offlineLedger.ts`, `src/providers/LedgerProvider.tsx`; `src/data/__tests__/offlineLedger.test.ts`, `src/providers/__tests__/LedgerProvider.test.tsx` | MAZ-55, 71/72, 87; restart, reconnect, account isolation and same-field races |
| Shared membership, trips, privacy | `server/infrastructure/households.ts`, `src/features/households/`; `tests/households-server.test.ts`, `e2e/households-mobile.spec.ts` | MAZ-56, 75/76, 91/93; two users, historical membership and payer-only accounts |
| Shared splits, reports, settlement, audit | `src/domain/households.ts`, `server/infrastructure/households.ts`; `tests/households-domain.test.ts`, `tests/households-server.test.ts` | MAZ-57/58, 75/77, 91/92; exact cents, no double count, monthly transfers |
| Shared recurrence | `server/infrastructure/households.ts`; `tests/households-server.test.ts` | MAZ-59, 75, 91; server catch-up, membership change and idempotency |
| Receipts | `server/application/receipts.ts`, `src/data/receipts*`; `tests/server.test.ts`, `e2e/entries.spec.ts` | MAZ-60, 78, 94; ownership, decoding, preview and failure recovery |
| Overview and charts | `src/features/overview/`; `tests/overview.test.ts`, `tests/moneyFlow.test.ts`, web UI tests | MAZ-77, 92; personal share totals and accessible equivalents |
| Push and widgets | `server/application/push.ts`, `src/widgets/`; `tests/push-server.test.ts`, widget tests | MAZ-61, 79/80; simulator navigation plus physical APNs and WidgetKit checks |
| Build, deployment and upgrade | `Dockerfile`, `compose.yaml`, `.github/workflows/`, `e2e/` | MAZ-62–65, 72, 81/82, 95–98; SQLite copy/rollback, TestFlight upgrade, real API browser and cross-client journeys |
| .NET host foundation | `apps/backend/` and `.github/workflows/backend.yml`; controller-based health/readiness and real HTTP xUnit and Awesome Assertions checks in `Penny.Backend.IntegrationTests` | MAZ-51; boot/config validation, liveness/readiness, controller error envelope, body cap, cancellation and graceful shutdown. Product routes and SQLite schema parity remain later gates. |

Migration impact: current `src/domain/households.ts` types describe some concepts differently from the actual HTTP envelopes in `src/data/households.ts`. Contract consumers use the wire fixtures and API schema, not an internal domain type, as their serialization source. Any deliberate API behavior change must update OpenAPI, fixtures and the compatibility policy in one change.
