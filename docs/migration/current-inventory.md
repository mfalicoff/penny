# Current product inventory

Audited from `src/app/`, `server/app.ts`, `server/http/`, `server/infrastructure/database.ts`, `src/data/`, `Dockerfile`, `compose.yaml`, `.github/workflows/` and the existing test suites on 2026-10-19.

## User routes

Expo Router in `src/app/` exposes:

| Route | Current surface |
| --- | --- |
| `/` | Monthly overview, calendar, breakdown and money flow |
| `/transactions`, `/entries/new` | Search/filter and create/edit entry flow |
| `/accounts`, `/categories`, `/recurring` | Personal reference data and schedules |
| `/trips`, `/trips/[id]` | Personal and linked shared trip workflows |
| `/households`, `/households/[id]` | Membership, shared expense and monthly settlement |
| `/households/[id]/expenses/[expenseId]` | Shared expense detail/edit |
| `/auth/callback` | OIDC browser/native callback |

`src/app/_layout.tsx` composes the root navigator; feature screens and domain/data code live outside the route directory. The API has **29 paths and 38 method/path operations**, all recorded in `contracts/openapi.json`. `tests/contracts.test.ts` fails if a current `server/http/` route is missing from that contract.

## Persistence and identity

| Location | Format and migration concern |
| --- | --- |
| SQLite `users`, `oidc_identities`, `sessions` | User IDs, scrypt hashes/salts, provider identities and hashed session tokens must survive backend replacement. |
| SQLite `ledgers` | One JSON ledger per user and atomic integer revision. Reads upgrade v1–v3 in memory to v4; validated writes persist v4 and increment revision. |
| SQLite `receipts` | Binary bytes and ownership; households may grant a member read access without transferring ownership. |
| SQLite household, trip, member-period, invite, expense, split, recurring, reimbursement and audit tables | Server-owned shared state, history and per-entity revisions. |
| SQLite `push_devices`, `push_outbox`, `push_deliveries` | Session-scoped Expo tokens and durable delivery work; retain bridge behavior until push migration passes. |
| AsyncStorage `penny:active-account` and `penny:ledger:<lowercase-email>` | Per-account `{base,local}` v4 JSON. Differences are unsynced personal edits and must survive both native and browser migration. |
| Native SecureStore `penny-session`, `penny-theme` | Native bearer token and appearance. |
| Browser HttpOnly cookie, localStorage `penny-theme` | Web token is deliberately absent from JavaScript storage; appearance is local. |

## Delivery behavior

`server/index.ts` binds the API and serves the Expo web export from `dist/` on one origin. Local development uses Node 24+, npm and a SQLite file under `data/`. The supplied Dockerfile builds web assets and runs Node with a volume at `/data`; Compose publishes port 3001 and forwards auth, CORS and OIDC settings. The container CI builds amd64/arm64 images after lint, type checks, tests and Chromium Playwright. A separate EAS workflow builds and signs legacy Android/iOS releases. These are baseline operations; the .NET API and native/browser replacements need separate deployment and rollback evidence before legacy hosting is removed.

The existing `tests/` suite covers HTTP/SQLite, domain rules and failure paths; `src/**/__tests__/` covers component/provider behavior; `e2e/` runs Chromium journeys against the exported web app and temporary SQLite. These do not establish iPhone/iPad simulator, Firefox/WebKit, physical APNs or data upgrade behavior of future stacks.
