# Current product inventory

Audited from `src/app/`, `server/app.ts`, `server/http/`, `server/infrastructure/database.ts`, `src/data/`, `Dockerfile`, `compose.yaml`, `.github/workflows/` and the existing test suites on 2026-11-07.

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

`src/app/_layout.tsx` composes the root navigator; feature screens and domain/data code live outside the route directory. The API has **31 implemented paths and 40 method/path operations**, plus the planned search v1 operation, all recorded in `contracts/openapi.json`. `tests/core/contracts.test.ts` fails if a current `server/http/` route is missing from that contract.

## Persistence and identity

| Location | Format and migration concern |
| --- | --- |
| SQLite `users`, `oidc_identities`, `sessions` | User IDs, provider identities and hashed session tokens must survive backend replacement. Scrypt hashes/salts are imported unchanged but not verified by .NET; password accounts must reset ([authentication](authentication.md)). |
| SQLite `ledgers` | One JSON ledger per user and atomic integer revision. Reads upgrade v1–v3 in memory to v4; validated writes persist v4 and increment revision. |
| SQLite `receipts` | Binary bytes and ownership; households may grant a member read access without transferring ownership. |
| SQLite household, trip, member-period, invite, expense, split, recurring, reimbursement and audit tables | Server-owned shared state, history and per-entity revisions. |
| SQLite `push_devices`, `push_outbox`, `push_deliveries` | Session-scoped Expo tokens and durable delivery work; retain bridge behavior until push migration passes. |
| AsyncStorage `penny:active-account` and `penny:ledger:<lowercase-email>` | Per-account/per-server `{base,local}` v4 JSON. Differences are durable unsynced personal edits; preserve during native/browser migration. |
| AsyncStorage `penny:server-connection` | Saved `{url,legacyUrl,version?}`; original server keeps unscoped keys, other URLs add a hex suffix to session/account/ledger keys. First upgrade preserves the original embedded URL without a probe. |
| Native SecureStore `penny-session`, `penny-theme` | Native bearer token and appearance. |
| Native SecureStore `penny-app-lock` | Device-local biometric preference; fail closed on read failure, preserve drafts/content tree while obscured. |
| Browser HttpOnly cookie, localStorage `penny-theme` | Web token is deliberately absent from JavaScript storage; appearance is local. |

## Delivery behavior

`server/index.ts` binds the API and serves the Expo web export from `dist/` on one origin. Local development uses Node 24+, npm and a SQLite file under `data/`. The supplied Dockerfile builds web assets and runs Node with a volume at `/data`; Compose publishes port 3001 and forwards auth, CORS and OIDC settings. The container CI builds amd64/arm64 images after lint, type checks, tests and Chromium Playwright. A separate EAS workflow builds and signs legacy Android/iOS releases. These are baseline operations; the .NET API and native/browser replacements need separate deployment and rollback evidence before legacy hosting is removed.

`tests/core/` covers HTTP/SQLite and pure rules; `tests/ui/` covers iOS/Android/web components/providers; `tests/e2e/web/` runs Chromium against the export and temporary SQLite. `tests/e2e/native/` covers legacy native server-selection journeys with isolated devices. These do not establish replacement Swift/.NET/TanStack, PostgreSQL plans/import, Firefox/WebKit, physical APNs or in-place upgrade behavior. See [testing](../testing.md).

Current `/api/info` is public for signed-out server identity checks. Household expense payment routes return per-share payments/paymentsClosed; shared projection returns recorded `transactions` and month-only `scheduled` previews. The updated OpenAPI captures these additions since October. PostgreSQL/search and the redesigned clients are planned differences, not present in the running legacy app.
