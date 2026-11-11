# Full-stack test environment and shared fixtures (MAZ-62)

One command starts a disposable environment: a pinned PostgreSQL 18 container (pg_trgm and pgvector), its own migrated database and restricted roles, and the real .NET API built from this checkout. Browser (MAZ-95) and simulator (MAZ-81) runners point at it, seed deterministic data, move the server clock, inject failures and tear it down. The same seeds and language-neutral fixtures are consumed by the TypeScript, C# and Swift suites.

Code: `scripts/test-env/` (runner, seeder, legacy comparison, local OIDC provider), `scripts/fixtures/generate-golden.ts`, `apps/backend/src/Penny.Backend.Api/Testing/` (test controls) and `Persistence/Testing/TestDataReset.cs`, `contracts/fixtures/`, `contracts/swift/`. Tests: `tests/core/golden-fixtures.test.ts`, `tests/core/test-env.test.ts`, `tests/fullstack/environment.test.mjs`, `UnitTests/Contracts/GoldenFixtureTests`, `UnitTests/Configuration/TestControlOptionsTests` and `FaultRegistryTests`, `IntegrationTests/Http/TestControlsTests`, `IntegrationTests/Contracts/FullStackSeedTests`, `contracts/swift/Tests`.

## Prerequisites

Docker or Podman, the pinned .NET SDK, Node 24 and the search model, as for the backend ([README](../../apps/backend/README.md)):

```sh
npm ci
node apps/backend/development/download-model.mjs
bash apps/backend/dotnet.sh restore Penny.Backend.slnx --locked-mode
```

No `apps/backend/.env` is needed or read: every run generates its own passwords, control token and receipt key. Podman users can set `PENNY_CONTAINER_CLI=podman` (the runner otherwise tries `docker`, then `podman`).

### Without a container runtime

Where Linux containers are unavailable (GitHub-hosted macOS runners), `PENNY_POSTGRES=native` replaces the container with a private PostgreSQL 18 cluster per run. Its binaries come from the flake, not the dev shell, so entering the project never fetches a database:

```bash
nix build .#test-postgres --out-link .cache/test-postgres   # PostgreSQL 18 with pg_trgm and pgvector
export PENNY_POSTGRES=native PENNY_POSTGRES_BIN="$PWD/.cache/test-postgres/bin"
node scripts/test-env/penny-env.mjs up
```

Each run `initdb`s a cluster in `.cache/test-env/<id>/pgdata` (random admin password, scram authentication, loopback TCP only, no Unix socket, durability off like the container's tmpfs), creates the database and applies the same `init-roles.sh`, and `down` stops it with `pg_ctl` and deletes it. It still never connects to a server it did not create. Any PostgreSQL 18 with pgvector 0.8 or later works through `PENNY_POSTGRES_BIN` (or `pg_config` on `PATH`); the nixpkgs pgvector can trail the pinned image's, so the container stays the reference for backend CI.

## One command

```sh
# Start, seed, run a command against it, collect artifacts, always tear down:
npm run test-env -- run --seed searchable-household -- npx playwright test
# Or keep an environment up while you work:
npm run test-env -- up --seed searchable-household
npm run test-env -- status
npm run test-env -- down
```

`up` prints the run id, API URL and state file; `run` exports `PENNY_TEST_RUN`, `PENNY_API_URL` and `PENNY_TEST_TOKEN` (and `PENNY_OIDC_ISSUER` with `--oidc`) to the command and exits with its status. Options: `--seed NAME`, `--host 0.0.0.0` (listen on every interface), `--port N`, `--origins a,b` (browser origins allowed by CORS), `--oidc`, `--no-build` (reuse the Release build), `--no-worker` (no shared recurrence worker), `--run-id ID`, `--keep` (`run` only: leave it up). Other commands act on the most recent environment unless `--run-id` is given: `env` (print exports), `reset`, `clock <ISO>|reset`, `fault '<json>'|clear`, `user [label]`, `seed <scenario>`, `artifacts [dir]`, `compare`, `down [--all]`.

Each run gets a random id (`r` + 10 hex), container `penny-test-<id>` labeled `penny.test-run=<id>`, database `penny_test_<id>` on tmpfs (no volume), a random loopback port for PostgreSQL and the API, and `.cache/test-env/<id>/` (mode 0700; `env.json` 0600) for state and logs. Concurrent runs, including parallel CI jobs on one machine, never share a database, port, token or receipt directory.

Startup: create the container with the repository's `init-roles.sh` (roles and extensions, as in development), wait for TCP readiness, run `migrate` with the migration role, apply `grant-runtime.sql`, start the API (`ASPNETCORE_ENVIRONMENT=Testing`, runtime role, generous rate limits, recurrence and embedding workers on) and wait for `/api/ready`. If any step fails, everything created so far is removed before the error is reported (with the last API log lines), and an API that exits during startup is detected immediately.

## Simulators and devices

| Runner | API URL |
| --- | --- |
| Browser on this machine | `PENNY_API_URL` (`http://127.0.0.1:<port>`); add its origin with `--origins` if it is not one of the defaults (`localhost`/`127.0.0.1` on 8081 and 4173) |
| iOS Simulator | Same URL: the simulator shares the host's loopback |
| Android Emulator | `http://10.0.2.2:<port>` (printed as `android` by `up`) |
| Physical device or another machine | `--host 0.0.0.0`, then `http://<host LAN address>:<port>`. Only on a trusted network: the API has test controls |

The environment serves plain HTTP. The native app reaches `http://127.0.0.1:<port>` without an App Transport Security exception (loopback IP addresses are exempt); `apps/ios/scripts/ios.sh ui-test` starts this environment with `--oidc` around the XCUITest plans and trusts the provider certificate (`PENNY_OIDC_CERTIFICATE` in the runner environment) on each simulator ([native UI tests](../ios-ui-tests.md)).

## Seeding, users and reset

`contracts/fixtures/full-stack-seeds.json` holds the scenarios. Steps are HTTP actions (`ledger`, `rename`, `createHousehold`, `createTrip`, `invite`, `join`, `expense`, `reimburse`, `leave`, `sharedRecurring`, `clock`) with references such as `$user:alex`, `$household:maison`, `$expense:hydro`, `$today` and `$month`. `scripts/test-env/seed.mjs` runs them against any server (legacy or .NET); `FullStackSeedTests` runs the same file through the C# host. Users are registered per run as `<alias>.<run id>@penny.test` with random passwords; sessions are refreshed after each clock move, because sessions last 30 days of server time. `seed` writes the resulting aliases, ids and sessions to `.cache/test-env/<id>/seed-<scenario>.json` (0600) for runners.

| Scenario | Contents |
| --- | --- |
| `empty` | One new account, default ledger, no households |
| `searchable-household` | Two personal ledgers with duplicate titles, precomposed and decomposed accents, CJK and emoji titles, Unicode notes, a category and an account renamed after their entries were written, a personal trip and a paused rule; household Maison with three members, an exact split with a zero share, cam settling September and leaving (revoked membership, retained history), an unsettled October, a scheduled shared rule; shared trip Lisbon. `searchExpectations` publish ordered keys, match tiers and must-not-see keys per viewer; `pendingEdits` publish unsynced local changes and the local search results they give |
| `differential` | A real-time journey (`$now`) with `probes` for the legacy comparison |

`POST /api/test/users` (or `user [label]`) creates a ready account (`{userId, email, password, token}`) for tests that do not need a scenario. `POST /api/test/reset` deletes every product row (children first, in foreign-key order from the EF model), keeps migration history, unpins the clock and clears faults.

## Test controls

The API exposes `/api/test/*` only when `TestControls__Enabled=true`. Every request needs `X-Penny-Test-Token` (the run's random 64-hex token, compared in constant time); the routes are not in `contracts/openapi.json` or the generated OpenAPI document.

| Control | Request |
| --- | --- |
| State | `GET /api/test/state` → `{environment, now, clockPinned, faults}` |
| Clock | `PUT /api/test/clock {"now": "2026-10-15T12:00:00Z"}` pins the server `TimeProvider` (sessions, join days, month cutoffs, due rules, audit and created instants); `DELETE` returns to system time. Pinned time does not advance, so writes share one instant and same-day ties fall to ids |
| Faults | `PUT /api/test/faults {"rules": [{"method": "PUT", "pathPrefix": "/api/ledger", "status": 503, "times": 1}]}`. Fields: `target` (`http`, default, or `push`), `method`, `pathPrefix`, `status` (400–599), `delayMs` (≤ 30,000), `abort` (drop the connection), `times` (default: until cleared). Rules apply in order, before routing; `/api/test/*` is never faulted. `DELETE` clears them |
| Users | `POST /api/test/users {"label": "web"}` |
| Reset | `POST /api/test/reset` |

`push` rules apply to the MAZ-61 delivery worker, which consults the same registry before each provider call: `method` names the provider (`apns` or `expo`; any when unset), `abort` answers the call with a network retry, `status` 410 with an invalid token, 429/5xx with a retry and other 4xx with a permanent failure ([push](push.md#test-controls)). The legacy Node server has no controls.

### Production safety

- Off unless explicitly enabled; when off the controller is removed from MVC and the fault middleware is not registered, so `/api/test/*` is an unknown route (401 anonymous, 404 signed in).
- The host refuses to start with controls enabled in the `Production` environment, without a 32+ character token, or when `ConnectionStrings__Postgres` names a database outside `TestControls__DatabasePrefix` (default and minimum `penny_test`).
- Reset re-checks the connected database name and refuses anything outside the prefix.
- The runner never accepts a connection string: it only talks to the container or native cluster it created. Fixtures contain only synthetic `.test` data; the runner writes no secrets to artifacts.

Tests: `TestControlOptionsTests`, `FaultRegistryTests`, `TestControlsTests` (absent when disabled, refused in Production, token, clock reaching sessions, exact fault counts under concurrency, aborts, invalid rules, reset and the prefix guard).

## Local OIDC provider

`--oidc` starts `scripts/test-env/oidc-provider.mjs` on `https://127.0.0.1:<port>` with a throwaway self-signed certificate generated in Node, an RS256 key, discovery, JWKS, an auto-approving `/authorize` (S256 PKCE required; `login_hint` chooses the subject, email `<subject>@penny.test`) and `/token`. The API is configured with client `penny-test`, redirect URIs `http://localhost:8081/auth/callback`, `http://127.0.0.1:8081/auth/callback`, `http://127.0.0.1:4173/auth/callback` and `penny://auth/callback`, and `TestControls__OidcCertificate`, which makes its provider client trust exactly that certificate (by SHA-256) in addition to normal validation. `PUT /control` on the provider (same token) sets `{"emailVerified": false}` or `{"fail": "token"|"authorize"}`.

Browsers must ignore HTTPS errors for the provider origin (Playwright `ignoreHTTPSErrors`). The iOS Simulator needs the certificate trusted: `xcrun simctl keychain booted add-root-cert <certificate.pem>`, using the `oidcCertificate` path that `up --oidc` prints. ID tokens use real time because token lifetime validation does not use the pinned clock.

## Golden fixtures

| Fixture | Contents | Consumers |
| --- | --- | --- |
| `money.json` | Client amount parsing, personal shares, stored total/share bounds | TS, C# (bounds through `LedgerReader`), Swift decoding |
| `recurrence.json` | Next occurrence (short months, leap years, year end, DST weeks) and 12-step anchored sequences | TS, C# `RecurringDates`, Swift decoding |
| `merge-conflicts.json` | Three-way offline merge (`src/domain/merge.ts`) | TS, Swift decoding; the server never merges (it returns 409) |
| `full-stack-seeds.json` | Scenarios, search expectations, pending edits, differential probes | TS (structure, pending local search), Node runner, C# `FullStackSeedTests`, Swift decoding |
| `redesign-states.json` | Data state for each of the 61 redesign cards (scenario, alias, view, appearances, faults, stale write) and recorded/projected totals | TS (coverage, totals recomputed from the seed), C# (stale payment 409, totals from the API), Swift decoding |
| `manifest.json` | SHA-256 and consumers of every fixture | TS, C#, Swift |

`money`, `recurrence` and `merge-conflicts` are generated from the legacy TypeScript rules by `npm run fixtures:generate`; `npm run fixtures:check` (CI) fails if any generated file or the manifest is stale. Generation reads no clock, randomness or locale; the TS suite regenerates under UTC+14, UTC−3:30 and Lord Howe and compares bytes. Hand-written fixtures are covered by the manifest hash, so an edit must regenerate the manifest, which every language checks. All consumers decode into strict typed models (zod `strictObject`, `System.Text.Json` with unmapped members disallowed and required members enforced, Swift `Codable` with a re-encode comparison), so an unknown, missing or mistyped field fails everywhere. `FullStackSeedTests` also seeds the scenario twice and compares normalized ledgers and projections.

The Swift package (`contracts/swift`, Swift 6, no dependencies) supplies the models, loader and hashes; behavior assertions are added by MAZ-70 (ledger, recurrence, reports and local search: `apps/ios/Packages/PennyKit/Tests/PennyDomainTests`, [ledger rules](../ios-ledger-domain.md#fixtures)), 71 (sync), 73 (search) and 75 (shared money) as they port the rules.

## Redesign specimens

`redesign-states.json` maps all 61 cards of `contracts/design-baseline.json` (ids such as `iphone-home`, `ipad-home`, `web-home`) to a scenario and alias, the view at the scenario clock (2026-10-15), and the appearances to capture: light and dark, except the two cards drawn in dark (`iphone-home-dark` and the `iphone-receipt` viewer), which pin it. Financial cards reference the `alex-2026-10` totals (recorded 1,259.50 spending, 500.00 investment; projected adds the 2026-10-20 shared Streaming share and the 2026-10-31 Gym rule). Failure states: `iphone-offline` (abort every request), `iphone-save-error`/`iphone-saved-toast` (one 503 on `PUT /api/ledger`, then success), `iphone-payment-stale` (a second device repeats a share payment with the revision it read: 201 then `409 Expense changed. Refresh and try again.`). Client-only states (signed-out server and account screens, and the `static` foundations card) have no scenario; `iphone-receipt` waits for a seeded receipt (MAZ-78/94). Visual comparison remains MAZ-122.

## Legacy versus .NET comparison

`npm run test-env -- compare` (and the full-stack suite) starts the legacy Node server on a temporary SQLite file, seeds the `differential` scenario on both servers at real time, sends every probe to both and compares status and body after normalizing generated ids, tokens, invite codes and instants; per-user lists are ordered by alias, and ledger lists, whose read order is documented as insignificant ([ledger](ledger.md#storage-mapping-and-read-order)), by id. All 17 probes (ledger read/stale/invalid writes, auth, unknown routes, households, expenses, projection, month recap, stale delete, payments, audit) currently match. A deliberate difference would be listed in the scenario's `knownDifferences` with its reason. SQLite is only the legacy reference and import source; v2 database tests always use PostgreSQL.

## Artifacts and CI

The comparison writes `test-results/fullstack/parity/parity-report.{md,json}` (normalized bodies only) and, in GitHub Actions, appends the Markdown table to the job summary. Triage is in the [parity report](parity-report.md#triage).


`run` and the full-stack suite copy `api.log`, `postgres.log` and `environment.json` (no token or passwords) to `test-results/fullstack/<run id>/`. CI (`.github/workflows/backend.yml`) runs `fixtures:check` and `npm run test:fullstack` in the `fullstack` job, always sweeps leftovers with `down --all` and uploads `test-results/fullstack/`; the `swift-contracts` job runs `swift test --package-path contracts/swift` in the digest-pinned `swift:6.2-noble` image. Reproduce locally with the same commands; for the Swift job without a Mac:

```sh
podman run --rm -v "$PWD/contracts:/work/contracts:ro,z" -w /work/contracts/swift \
  --tmpfs /work/contracts/swift/.build:exec docker.io/library/swift:6.2-noble swift test
```

`down --all` removes every environment: those with state (stopping their API) and any container labeled `penny.test-run`, for runs whose state directory was lost. An API process whose state directory was deleted by hand is not tracked; stop it yourself.

## Limitations

- Swift consumes fixtures by strict decoding and hashes only; no Swift behavior exists before MAZ-66/70.
- Receipts are not seeded because .NET receipts are MAZ-60. `push` faults reach the delivery worker only when it runs in the environment (`Push__Worker`, on by default); real Expo or APNs calls are made only for devices a run registers.
- Pinned time is frozen (no ticking clock); scenarios avoid same-day ties that would depend on generated ids.
- The comparison covers the differential journey's 79 probes, including outsider and former-member calls: every legacy operation except the seven listed in [parity report](parity-report.md#operations-not-compared), which `tests/core/parity-coverage.test.ts` keeps accountable. Search and password reset are .NET-only.
