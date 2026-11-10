# Backend parity and regression gates (MAZ-64)

This report covers how the .NET/PostgreSQL backend is held to the legacy Node/SQLite contract, which differences are deliberate, which gates CI enforces, and how to triage a failure. Legacy Node/SQLite is only a comparison and import source; every v2 database test runs on real PostgreSQL 18.

Status as of 2026-11-09, based on `v2` at `a77653c` (MAZ-63).

## Gates

| Gate | What it proves | Where | CI job (`.github/workflows/backend.yml`) |
| --- | --- | --- | --- |
| Legacy versus .NET differential | 52 probes on both servers after the same seeded `differential` journey; responses must match after normalization, except for registered differences | `scripts/test-env/compare.mjs`, `tests/fullstack/environment.test.mjs` | `fullstack` (writes `parity-report.md` to the job summary and `fullstack-artifacts`) |
| Contract coverage | Each of the 40 legacy operations in `contracts/openapi.json` is either probed or listed as uncompared, with a reason and the suites that cover it instead. Each registered difference names its probe and the document that records it | `tests/core/parity-coverage.test.ts` | Application tests (`npm run test:core`) |
| Release journey | One flow through real HTTP and PostgreSQL: OIDC and password registration, a receipt upload linked from a ledger write, a two-user household and shared trip, a shared expense, push delivery, a shared rule run by the recurrence worker, monthly settlement, then a **new API host** over the same database. The new host reproduces sessions, ledger, receipt bytes, settlement, rule state and membership, sends nothing twice, and a logout on it revokes the session everywhere | `apps/backend/tests/Penny.Backend.IntegrationTests/Http/UserJourneyTests.cs` | `backend` |
| Feature suites | Concurrency, isolation, malformed and oversized input, outbox recovery, import and backup/restore (see [coverage](#regression-coverage)) | `apps/backend/tests/` | `backend` |
| Golden fixtures | Generated fixtures are current; hand-written ones are pinned by manifest hash; Swift decodes them strictly | `npm run fixtures:check`, `contracts/swift` | `fullstack`, `swift-contracts` |

## Legacy versus .NET comparison

The `differential` scenario (`contracts/fixtures/full-stack-seeds.json`) seeds two users on each server: a ledger with a renamed category, a household with an equal and an exact expense, a shared rule, and a trip both users belong to. It then sends the same 52 probes to both servers in order. The probes cover reads, validation failures, stale revisions (409), edits, rule pause and delete, settlement boundaries, rename/invite/remove permissions, trip creation, edits, leave and archive, the audit trail, receipts, the public endpoints, anonymous access, and logout.

Before comparing, generated ids, tokens, emails, invite codes and instants are replaced by placeholders. Lists keyed by user are ordered by alias, and ledger lists by id, because ledger read order is not part of the contract ([ledger](ledger.md#storage-mapping-and-read-order)). Equal splits in the scenario use totals divisible by the member count: remainder cents go to the lexically first generated user id, and those ids differ between the two servers. The remainder rule itself is pinned by `shared-splits.json` and the unit suites.

### Registered differences

The comparison ignores only these paths (`knownDifferences` in the scenario; `*` matches one path segment):

| Probe | Path | Reason |
| --- | --- | --- |
| rule pause | `/body/rule/anchorDay` | .NET returns and audits the stored rule, including `anchorDay`; legacy echoed the request ([shared recurrence](shared-recurrence.md#deliberate-differences-from-the-legacy-service)) |
| audit, audit after edits | `/body/events/*/after/anchorDay` | Same: audit snapshots of rules include the stored anchor day |

### Operations not compared

Seven legacy operations cannot be probed through the shared fixture. The fixture refuses `password`, `token` and `code` keys so it can never hold secrets, and the legacy comparison server runs without an identity provider. Each operation is covered elsewhere; `tests/core/parity-coverage.test.ts` holds the list and checks that the evidence files exist.

| Operation | Covered by |
| --- | --- |
| `GET /api/auth/oidc`, `POST /api/auth/oidc/start`, `POST /api/auth/oidc/complete` | Legacy `tests/core/oidc.test.ts`; .NET `OidcTests`, the release journey, and the full-stack local-provider test |
| `POST /api/auth/login` | The seeder signs in on both servers for every user; `server-boundaries.test.ts`, `AuthTests` |
| `POST`/`DELETE /api/push/devices` | `PushDeviceTests`, `ImportedPushTests` |
| `POST /api/households/join` | Seed steps join on both servers, and later probes compare the resulting membership; `HouseholdMembershipTests` |

The .NET-only operations `POST /api/auth/password-reset` (MAZ-123), `POST /api/v1/search/transactions` (MAZ-121) and `GET /api/ready` have no legacy counterpart and are tested in their own suites.

### Documented deliberate differences

Each feature document records the behavior that intentionally differs from legacy. Most of it is invisible to the probes: concurrency, ordering ties, stored text limits and expiry. All of it is covered by that feature's .NET suite.

| Area | Document |
| --- | --- |
| Password hashes (Identity PBKDF2; legacy scrypt accounts reset through MAZ-123) | [authentication](authentication.md#compatibility) |
| Ledger: trip erasure guard, foreign-keyed `sharedHouseholdId`, NUL/surrogate refusal, revision ceiling, receipt metadata from the receipt row, read order | [ledger](ledger.md#deliberate-differences-from-the-legacy-service) |
| Households: archived households, concurrency, stored text, ordering ties, rate limit, period end, millisecond instants | [households](households.md#deliberate-differences-from-the-legacy-service) |
| Shared expenses: former-member projections, percentage tie-break, audit snapshots, receipt URI, corrupt rules | [shared expenses](shared-expenses.md#deliberate-differences-from-the-legacy-service) |
| Shared recurrence: paused periods skipped, revision on advance, preserved anchors, stored-rule responses, per-rule isolation, catch-up limit | [shared recurrence](shared-recurrence.md#deliberate-differences-from-the-legacy-service) |
| Settlement: former members' audit limit, audit redaction on read, ordering ties | [settlement](settlement.md#deliberate-differences-from-the-legacy-service) |
| Receipts: no ETag/304, storable names, no request deadline, encryption at rest | [receipts](receipts.md#deliberate-differences-from-node) |
| Push: APNs transport, 24-hour expiry, explicit leases, invalid-token cleanup, `Retry-After` | [push](push.md#deliberate-differences-from-the-legacy-service) |

## Regression coverage

Existing .NET suites that the release gates depend on (`apps/backend/tests/Penny.Backend.IntegrationTests`):

| Concern | Suites |
| --- | --- |
| Races and concurrency | `HouseholdConcurrencyTests`, `SharedExpenseConcurrencyTests`, `SettlementConcurrencyTests`, `SharedRecurrenceConcurrencyTests`, `PushConcurrencyTests`; ledger compare-and-swap (`LedgerTests`), racing registrations, first OIDC sign-ins and reset codes; two embedding workers (`SearchIndexingTests`) |
| Cross-account isolation | `LedgerTests` (overlapping ids, foreign receipts), `HouseholdTests` (non-members), `ReceiptTests`, `SearchAccessTests`, `PushDeviceTests`, `ImportedRepositoryTests`; the release journey checks receipt privacy after restart |
| Malformed and oversized input | `BoundaryTests` (malformed JSON, 413 by length and chunked, aborts, timeouts, shutdown drain), `LedgerTests`, `ReceiptTests` (size limits), `OidcTests` (callback length), `SearchFixtureTests` (invalid and tampered cursors) |
| Outbox and worker recovery | `PushConcurrencyTests` (crash after claim, lost lease, cancellation), `SharedRecurrenceConcurrencyTests` (connection loss), `PushDeliveryTests` (failed write leaves no message), `SearchMaintenanceTests` |
| Schema upgrades | `MigrationTests` (repeat, lock, newer history, foundation adoption, rollback) |
| Old clients | `LedgerTests` v1/v3 bodies that omit newer collections; legacy Expo push envelopes (`PushDeviceTests`, `ImportedPushTests`) |
| Import, backup and restore | `SqliteImportTests` (dry run, interrupted resume, checksums, verification mismatch, lock), `ImportCommandTests`, `Imported*Tests`, `ImportedRepositoryTests` backup/restore after post-import writes, `ReceiptMaintenanceTests` |

## Commands

```sh
# .NET: format, analyzers, build, unit and real-PostgreSQL integration (README for setup)
bash apps/backend/dotnet.sh test --solution Penny.Backend.slnx --configuration Release
# The release journey only
bash apps/backend/dotnet.sh test --project tests/Penny.Backend.IntegrationTests -c Release -- --filter-class '*UserJourneyTests'
# Legacy versus .NET comparison against a running environment
npm run test-env -- up && npm run test-env -- compare; npm run test-env -- down
# Everything the fullstack CI job runs (environment, seeds, OIDC, comparison)
npm run test:fullstack
# Contract coverage, fixtures and runner logic (no containers)
node --experimental-strip-types --no-warnings --test tests/core/parity-coverage.test.ts tests/core/golden-fixtures.test.ts tests/core/test-env.test.ts
```

With rootless Podman, set `DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock` and `TESTCONTAINERS_RYUK_DISABLED=true` for the .NET suites and `PENNY_CONTAINER_CLI=podman` for the environment runner. In a deep checkout (such as a worktree under `.claude/worktrees/`), set `TESTINGPLATFORM_PIPE_DIRECTORY` to a short directory, or the test host fails with a Unix socket path over 103 bytes.

## Baseline timings

These are wall-clock times from one local run (AMD Ryzen, 8 GB RAM, rootless Podman) on 2026-11-09. They are for spotting regressions, not CI budgets. Hosted runners vary, so no timing assertion fails CI; the search latency targets remain in [search](search.md#measured-performance).

| Run | Time |
| --- | --- |
| Full .NET suite (442 unit and 333 integration tests, one PostgreSQL container) | Unit 4.6 s; integration 3 min 46 s |
| Release journey alone, including container start | 18 s (the test itself about 4 s) |
| Environment `up` plus the 52-probe comparison, including legacy start | About 1 to 2 minutes |

Treat a doubling of these on comparable hardware as a regression worth investigating, starting with the slowest tests in the TRX report.

## Triage

1. **Find the failing gate.** The `backend` job uploads `backend-test-results` (TRX). The `fullstack` job puts the parity table in the job summary and uploads `fullstack-artifacts`, which holds `parity/parity-report.{md,json}` and, per environment, `api.log`, `postgres.log` and `environment.json`.
2. **A parity difference.** The summary lists each unregistered difference as `probe /json/path: legacy … vs .NET …`, and `parity-report.json` has both full normalized responses. Reproduce it locally with `npm run test-env -- up`, then `compare`. Then decide:
   - If .NET is wrong, fix .NET and keep the probe.
   - If the change is deliberate, record it in the feature document's deliberate-differences section, then add a `knownDifferences` entry to the scenario. Its `reason` must link that document; `parity-coverage.test.ts` enforces this. Keep the path as narrow as possible.
   - If the difference depends on generated ids or time (remainder cents, same-instant ordering), change the probe data to remove the dependence. Do not widen the normalizer.
3. **A new legacy route.** `parity-coverage.test.ts` fails until the route has a probe in the `differential` scenario, or an `uncompared` entry with a reason and evidence.
4. **The release journey.** The failing assertion names the step. Steps 1–7 run on the shared host and step 8 on a fresh host. A failure only after the restart means some state lived in process memory rather than in PostgreSQL.
5. **A race or concurrency test that fails intermittently.** Rerun only that class with `--filter-class`. Do not add retries or longer timeouts to make it pass. These tests coordinate through PostgreSQL locks (`WaitForLockWaitAsync`) rather than sleeps, so a timing failure usually means the locking order changed.
6. **Container or SDK failures.** See the backend README's troubleshooting section. A missing container runtime fails the suite; it is never skipped.

## Known limitations

These parts of MAZ-64 are still open:

- No large-ledger (near `LedgerLimits.MaxTransactions`) or bounded multi-client load check exists yet, and no timing budgets beyond the search benchmark. The search benchmark is `Explicit` and does not run in CI.
- No upgrade test runs on a database populated at the previous released migration.
- Old-client ledger bodies are tested over HTTP for v1 and v3 only. The v1–v3 `ledger-upgrades.json` cases are exercised by the unit suites, not over HTTP.
- No single test checks every route against outsider, former-member and anonymous callers; isolation is tested per feature.
- Post-cutover recovery is documented as forward-only ([postgresql](postgresql.md)). A point-in-time recovery rehearsal and an automated cutover rehearsal on sanitized production-shaped SQLite data are not done.
- `BoundaryTests.whenBodyExceedsLimit_RequestBodyFlow_ShouldReturnPayloadTooLarge` failed once in a full local run (on 2026-11-09, `ResponseEnded`: the connection was reset before the client read the 413), then passed 5/5 when run alone. It needs a fix rather than a retry.
- The comparison runs one scenario at real time. Clock-dependent behavior (month cutoffs, recurrence catch-up) is compared through the .NET suites and golden fixtures, not against legacy.
- Branch protection lives in the GitHub settings, not in this repository. Mark these jobs as required on `v2`: `.NET build, analyzers and PostgreSQL integration`, `Full-stack environment, fixtures and legacy comparison`, `Legacy lint and typecheck`, `Swift contract fixtures`.
