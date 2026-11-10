# Backend parity and regression gates (MAZ-64)

This report covers how the .NET/PostgreSQL backend is held to the legacy Node/SQLite contract, which differences are deliberate, which gates CI enforces, and how to triage a failure. Legacy Node/SQLite is only a comparison and import source; every v2 database test runs on real PostgreSQL 18.

Status as of 2026-11-10, based on `v2` at `a77653c` (MAZ-63).

## Gates

| Gate | What it proves | Where | CI job (`.github/workflows/backend.yml`) |
| --- | --- | --- | --- |
| Legacy versus .NET differential | 79 probes on both servers after the same seeded `differential` journey must match after normalization, except registered differences. This includes outsider and former-member calls on every household route | `scripts/test-env/compare.mjs`, `tests/fullstack/environment.test.mjs` | `fullstack` (`parity-report.md` in the job summary and in `fullstack-artifacts`) |
| Cutover rehearsal | A production-shaped legacy dataset goes through the documented SQLite → PostgreSQL cutover: snapshot, dry run, import, verify, search rebuild and verify, receipt verify, password reset. Then every one of about 460 reads, made with the imported legacy sessions, must equal legacy's response | `scripts/test-env/cutover.mjs`, `tests/fullstack/environment.test.mjs` | `fullstack` (`cutover-report.md` in the job summary and artifacts) |
| Contract coverage | Each of the 40 legacy operations in `contracts/openapi.json` is either probed or listed as uncompared, with a reason and evidence. Each registered difference names its probe and the document that records it | `tests/core/parity-coverage.test.ts` | Application tests (`npm run test:core`) |
| Release journey | One flow through real HTTP and PostgreSQL: OIDC and password registration, a receipt-backed ledger write, a two-user household and trip, a shared expense, push delivery, a recurrence-worker rule, settlement, then a **new API host** that must reproduce everything from the database | `Http/UserJourneyTests.cs` | `backend` |
| Authorization matrix | Driven by the contract, so new operations are included automatically. Every protected operation answers 401 to anonymous callers. Every operation on another user's household, expense, rule, member or receipt is refused for a signed-in outsider, and every household write is refused for a former member, with no data leaked and no stored row changed | `Http/AuthorizationMatrixTests.cs` | `backend` |
| Old clients | Every v1–v4 case of `ledger-upgrades.json` is written over HTTP and stored as the legacy upgrade output; unknown future versions are refused without a write | `Contracts/LedgerUpgradeFixtureTests.cs` | `backend` |
| Schema upgrades | A database populated through the API is taken back to each earlier migration, upgraded with `DatabaseMigrator` and runtime grants (plus `search-rebuild`), then fully read and written by a new host | `Migrations/PopulatedUpgradeTests.cs` | `backend` |
| Post-cutover recovery | Base backup, accepted writes, a restore point, then "incident" writes. A second PostgreSQL instance recovered from archived WAL to the restore point keeps every accepted write, sessions and receipts, and none of the incident writes | `Migrations/PointInTimeRecoveryTests.cs` | `backend` |
| Large ledger and concurrency | One entry over `LedgerLimits.MaxTransactions` is refused before any write. Eight users with 5,000-entry ledgers sync concurrently and stay isolated, within a p95 budget. Eight racing writers produce exactly one winner. The full-limit write, read and edit check is `Explicit` until [MAZ-137](https://linear.app/mfalicoff/issue/MAZ-137) | `Http/LargeLedgerTests.cs` | `backend` (the full-limit write is run by hand) |
| Oversized bodies | Uploads moderately over the limit always receive a readable 413; bodies far over the limit are refused without being read | `Http/BoundaryTests.cs` | `backend` |
| Feature suites | Concurrency, isolation, malformed input, outbox recovery, import and backup/restore (see [coverage](#regression-coverage)) | `apps/backend/tests/` | `backend` |
| Golden fixtures | Generated fixtures are current; hand-written ones are pinned by manifest hash; Swift decodes them strictly | `npm run fixtures:check`, `contracts/swift` | `fullstack`, `swift-contracts` |

Required checks: the repository's `main-v2` ruleset (covering `v2` and the default branch) requires `.NET build, analyzers and PostgreSQL integration`, `Full-stack environment, fixtures and legacy comparison`, `Legacy lint and typecheck` and `Swift contract fixtures`, with branches up to date before merging. Rulesets are repository settings and are not stored in this repository; change them under Settings → Rules.

## Legacy versus .NET comparison

The `differential` scenario (`contracts/fixtures/full-stack-seeds.json`) seeds three users on each server: a ledger with a renamed category, a household with an equal and an exact expense, a shared rule, and a trip. The third user, `cam`, never joins anything. The same 79 probes then go to both servers in order. They cover:

- reads, validation failures and stale revisions (409)
- expense and rule edits, settlement boundaries
- rename, invite and remove permissions
- trip creation, edits, leave and archive
- the audit trail, receipts, public endpoints, anonymous access and logout
- each household route called by `cam` (outsider) and by a member who left the trip (former member)

Matching legacy is not enough on its own, because a shared authorization bug would still match. The .NET matrix separately requires every outsider and former-member write to be refused.

Before comparing, generated ids, tokens, emails, invite codes and instants are replaced by placeholders. Lists keyed by user are ordered by alias, and ledger lists by id, because ledger read order is not part of the contract ([ledger](ledger.md#storage-mapping-and-read-order)). The scenario also avoids outcomes that depend on generated ids or on time:

- Equal splits use totals divisible by the member count, because remainder cents go to the lexically first generated user id. `shared-splits.json` pins that rule itself.
- A former member's own household audit is not probed, because legacy read the clock twice when someone left ([settlement](settlement.md#deliberate-differences-from-the-legacy-service)). `AuditTests` covers the .NET behavior.

### Registered differences

The comparison ignores only these paths (`knownDifferences` in the scenario; `*` matches one path segment):

| Probe | Path | Reason |
| --- | --- | --- |
| rule pause | `/body/rule/anchorDay` | .NET returns and audits the stored rule, including `anchorDay`; legacy echoed the request ([shared recurrence](shared-recurrence.md#deliberate-differences-from-the-legacy-service)) |
| audit, audit after edits | `/body/events/*/after/anchorDay` | Same: audit snapshots of rules include the stored anchor day |

### Operations not compared

Seven legacy operations cannot be probed through the shared fixture. The fixture refuses `password`, `token` and `code` keys so it can never hold secrets, and the legacy comparison server runs without an identity provider. Each is covered elsewhere; `tests/core/parity-coverage.test.ts` holds the list and checks that the evidence files exist.

| Operation | Covered by |
| --- | --- |
| `GET /api/auth/oidc`, `POST /api/auth/oidc/start`, `POST /api/auth/oidc/complete` | Legacy `tests/core/oidc.test.ts`; .NET `OidcTests`, the release journey, and the full-stack local-provider test |
| `POST /api/auth/login` | The seeder and the cutover rehearsal sign in on both servers; `server-boundaries.test.ts`, `AuthTests` |
| `POST`/`DELETE /api/push/devices` | `PushDeviceTests`, `ImportedPushTests`; the cutover rehearsal imports legacy devices |
| `POST /api/households/join` | Seed steps join on both servers, and later probes compare the resulting membership; `HouseholdMembershipTests` |

The .NET-only operations `POST /api/auth/password-reset` (MAZ-123), `POST /api/v1/search/transactions` (MAZ-121) and `GET /api/ready` have no legacy counterpart. They are tested in their own suites and in the cutover rehearsal.

## Cutover rehearsal

`npm run test-env -- cutover` (and the full-stack suite) rehearses [the cutover](postgresql.md#cutover-and-forward-only-recovery) end to end on synthetic data:

1. **Production-shaped data through the unchanged legacy API.** `legacy-clock.mjs` is preloaded so the legacy server's time follows a control file, which lets the dataset be built month by month over five past months:
   - 10 users with skewed ledgers: 2,500 entries for one, then 600, 300 and so on down to an empty ledger; about 3,700 entries in all
   - accounts, trips, personal rules, and 9 encrypted receipts linked from entries
   - two households and a shared trip, with members joining in different months and one leaving the trip
   - about 110 shared expenses in equal, exact and percentage splits, with some direct share payments
   - three settled months and two open ones (one overdue), shared rules, and Expo devices
   - one user who keeps only an expired session
2. **Record every read** each user can make with their legacy token: about 460 reads covering `me`, ledger, lists, projections, detail, audit, rules, expenses and recaps per month, plus expense detail and the expired session. Receipt bytes are hashed.
3. **Freeze and seal.** Stop the legacy server and run `snapshot-sqlite`.
4. **Import into an empty target** before the API starts: `import-sqlite --dry-run`, the import, `--verify`, then `search-rebuild`, `search-verify` and `receipts-verify`. A reset code is issued for one imported password account.
5. **Start .NET and compare.** Every recorded read is replayed with the same imported token and must equal legacy's response, with ledger lists compared by id. Receipt bytes must decrypt to the same hash and search must find imported entries. The account's legacy scrypt password is refused; redeeming the reset code revokes its imported sessions and the new password signs in.

Ids and instants are not normalized here, because the import keeps them. Only these deliberate differences are allowed:

| Allowed | Reason |
| --- | --- |
| Rule `anchorDay` | [Shared recurrence](shared-recurrence.md#deliberate-differences-from-the-legacy-service) |
| Ledger entry `receipt.name`/`mime`/`uri` come from the stored receipt | [Ledger](ledger.md#deliberate-differences-from-the-legacy-service) |
| A former member sees their own `member.left` event: only that event, by that reader, is excused, and the rest of the audit must match | [Settlement](settlement.md#deliberate-differences-from-the-legacy-service) |
| A former member's `leftAt` comes from their membership period, at most 50 ms after legacy's | [Households](households.md#deliberate-differences-from-the-legacy-service) |

To rehearse on a sanitized copy of production data, as step 1 of the cutover checklist requires, use the same commands. The report format and checks are the ones to sign off.

## Recovery after writes reopen

Once writes reopen on v2, recovery is forward-only ([cutover](postgresql.md#cutover-and-forward-only-recovery)). `PointInTimeRecoveryTests` rehearses it in the shared test container, which runs with `archive_mode=on`; segments are copied only while the archive directory exists.

1. Take a base backup (`pg_basebackup --wal-method=stream`).
2. Make accepted writes: a ledger entry, a shared expense and a receipt.
3. Create a restore point (`pg_create_restore_point`), then make incident writes: an entry, and the deletion of an earlier expense.
4. Recover a copy of the base backup with `restore_command`, `recovery_target_name` and `promote` on a second port.

A new API host over the recovered instance:
- passes readiness and accepts the existing sessions
- has every accepted write and none of the incident writes, so the deleted expense is back
- serves the receipt from the receipt root

For production, use the WAL archiving of your managed service or a tool such as pgBackRest or WAL-G ([operations](../operations.md#back-up)). The commands above show the recovery mechanics, not a production backup setup.

## Regression coverage

| Concern | Suites (`apps/backend/tests/Penny.Backend.IntegrationTests`) |
| --- | --- |
| Races and concurrency | `HouseholdConcurrencyTests`, `SharedExpenseConcurrencyTests`, `SettlementConcurrencyTests`, `SharedRecurrenceConcurrencyTests`, `PushConcurrencyTests`; ledger compare-and-swap (`LedgerTests`, `LargeLedgerTests`), racing registrations, first OIDC sign-ins and reset codes; two embedding workers (`SearchIndexingTests`) |
| Cross-account isolation | `AuthorizationMatrixTests` for every operation; per feature in `LedgerTests`, `HouseholdTests`, `ReceiptTests`, `SearchAccessTests`, `PushDeviceTests`, `ImportedRepositoryTests`; the release journey checks receipt privacy after restart |
| Malformed and oversized input | `BoundaryTests` (malformed JSON, 413 by length and chunked, bounded draining, aborts, timeouts, shutdown drain), `LedgerTests`, `ReceiptTests` (size limits), `OidcTests` (callback length), `SearchFixtureTests` (invalid and tampered cursors) |
| Outbox and worker recovery | `PushConcurrencyTests` (crash after claim, lost lease, cancellation), `SharedRecurrenceConcurrencyTests` (connection loss), `PushDeliveryTests` (failed write leaves no message, 24-hour expiry), `SearchMaintenanceTests` |
| Schema upgrades | `PopulatedUpgradeTests` (each earlier migration with data), `MigrationTests` (repeat, lock, newer history, foundation adoption, rollback) |
| Old clients | `LedgerUpgradeFixtureTests` (v1–v4 over HTTP), `LedgerTests` (v1/v3 bodies that omit newer collections cannot erase them), legacy Expo push envelopes (`PushDeviceTests`, `ImportedPushTests`), imported sessions in the cutover rehearsal |
| Import, backup and restore | The cutover rehearsal; `SqliteImportTests` (dry run, interrupted resume, checksums, verification mismatch, lock), `ImportCommandTests`, `Imported*Tests`, `ImportedRepositoryTests` backup/restore after post-import writes, `ReceiptMaintenanceTests`, `PointInTimeRecoveryTests` |

## Commands

```sh
# .NET: format, analyzers, build, unit and real-PostgreSQL integration (README for setup)
bash apps/backend/dotnet.sh test --solution Penny.Backend.slnx --configuration Release
# One class, e.g. the release journey or the large-ledger checks
bash apps/backend/dotnet.sh test --project tests/Penny.Backend.IntegrationTests -c Release -- --filter-class '*UserJourneyTests'
# Legacy versus .NET comparison against a running environment
npm run test-env -- up && npm run test-env -- compare; npm run test-env -- down
# Cutover rehearsal (starts legacy and its own .NET environment)
npm run test-env -- cutover
# Everything the fullstack CI job runs (environment, seeds, OIDC, comparison, cutover)
npm run test:fullstack
# Contract coverage, fixtures and runner logic (no containers)
node --experimental-strip-types --no-warnings --test tests/core/parity-coverage.test.ts tests/core/golden-fixtures.test.ts tests/core/test-env.test.ts
```

With rootless Podman, set `DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock` and `TESTCONTAINERS_RYUK_DISABLED=true` for the .NET suites and `PENNY_CONTAINER_CLI=podman` for the environment runner. In a deep checkout (such as a worktree under `.claude/worktrees/`), set `TESTINGPLATFORM_PIPE_DIRECTORY` to a short directory, or the test host fails with a Unix socket path over 103 bytes.

## Baseline timings

These are wall-clock times from local runs (AMD Ryzen, 8 GB RAM, rootless Podman) on 2026-11-09 and 10; hosted CI passed in 3 min 40 s (backend) and 3 min (fullstack). The large-ledger budgets are generous upper bounds that catch a pathological regression, not runner noise. Search latency targets remain in [search](search.md#measured-performance).

| Run | Time | Budget |
| --- | --- | --- |
| Full .NET suite before MAZ-64 (442 unit, 333 integration tests) | Unit 4.6 s; integration 3 min 46 s | — |
| Release journey, including container start | 18 s | — |
| First write of a 100,000-entry ledger (`Explicit`) | **47.9 s** alone; over 100 s on the shared test database after the full suite (see [limitations](#known-limitations)) | 60 s, run by hand |
| Read of that ledger / one-entry edit | 0.46 s / 2.9 s | 20 s / 60 s |
| 8 users × 5,000 entries, 4 concurrent read+write rounds | p50 1.39 s, p95 1.53 s, max 1.83 s | p95 15 s |
| Populated upgrade, per earlier migration | About 11 s, including `search-rebuild` | — |
| Point-in-time recovery rehearsal | About 27 s | — |
| Comparison: environment `up` plus 79 probes, including legacy start | About 1 to 2 minutes | — |
| Cutover rehearsal: build 6 s; import 9.7 s; search rebuild 32.8 s (3,700 entries and 110 expenses, embeddings included); environment and cutover 61 s | About 2 minutes in all | — |

The large-ledger checks print their timings to the test output (`MAZ-64 baseline: …` in the TRX report). Treat a doubling of any time on comparable hardware as a regression worth investigating, starting with the slowest tests in the TRX report.

## Triage

1. **Find the failing gate.** The `backend` job uploads `backend-test-results` (TRX). The `fullstack` job puts the parity and cutover tables in the job summary and uploads `fullstack-artifacts`, which holds `parity/parity-report.{md,json}`, `cutover/cutover-report.{md,json}` and, per environment, `api.log`, `postgres.log` and `environment.json`.
2. **A parity difference.** The summary lists each unregistered difference as `probe /json/path: legacy … vs .NET …`, and `parity-report.json` has both full normalized responses. Reproduce it locally with `npm run test-env -- up`, then `compare`. Then decide:
   - If .NET is wrong, fix .NET and keep the probe.
   - If the change is deliberate, record it in the feature document's deliberate-differences section, then add a `knownDifferences` entry to the scenario. Its `reason` must link that document (`parity-coverage.test.ts` enforces this). Keep the path as narrow as possible.
   - If the difference depends on generated ids or time (remainder cents, same-instant ordering, legacy's two clock readings), change the probe data to remove the dependence. Do not widen the normalizer.
3. **A cutover difference.** `cutover-report.json` lists each read with both statuses and its differences, and the `steps` exit codes show which command failed. A failing import or verify step is a no-go for a real cutover ([checklist](postgresql.md#cutover-and-forward-only-recovery)). Add an allowance to `knownDifferences` in `cutover.mjs` only for a documented deliberate difference, preferably as an `adjust` that excuses exactly that change.
4. **A new legacy route.** `parity-coverage.test.ts` fails until the route has a probe in the `differential` scenario, or an `uncompared` entry with a reason and evidence. `AuthorizationMatrixTests` covers new routes automatically once they are in the contract.
5. **The release journey, upgrade or recovery tests.** The failing assertion names the step. A failure only on the restarted, upgraded or recovered host means some state lived in process memory rather than in PostgreSQL, or a migration or grant is missing.
6. **A budget failure in `LargeLedgerTests`.** Compare the printed timings with the baseline above. A sudden multiple usually means a lost index or a per-row round trip. Profile the save phases before raising a budget.
7. **A race or concurrency test that fails intermittently.** Rerun only that class with `--filter-class`. Do not add retries or longer timeouts to make it pass. These tests coordinate through PostgreSQL locks (`WaitForLockWaitAsync`) rather than sleeps, so a timing failure usually means the locking order changed.
8. **Container or SDK failures.** See the backend README's troubleshooting section. A missing container runtime fails the suite; it is never skipped.

## Known limitations

- **Writing a full 100,000-entry ledger for the first time takes about 48 s locally, longer than the default 30 s request timeout** (`Backend__RequestTimeoutSeconds`). Such a write would therefore fail with 503 in production. EF inserts each new row individually: about 18 s for the entries and 27 s for their search documents, measured by phase. One-entry edits of the same ledger take 2.9 s and reads 0.5 s. Imports do not go through this path. The fix (bulk inserts, or a longer deadline for ledger writes) is [MAZ-137](https://linear.app/mfalicoff/issue/MAZ-137). Until then the full-limit test is `Explicit` and run by hand (`--filter-method '*whenLedgerAtTransactionLimit*'`, budget 60 s). The over-limit refusal and the concurrency check run in CI.
- Chunked uploads over the limit are cut off at the limit; only bodies with a declared length can be read and discarded first. A chunked client that keeps writing may see a reset instead of the 413.
- The comparison runs one scenario at real time. Clock-dependent behavior (month cutoffs, recurrence catch-up) is compared through the cutover rehearsal's past-dated dataset, the .NET suites and the golden fixtures.
- The cutover rehearsal's shared rules start after the rehearsal, so legacy's 60-second recurrence timer cannot race the snapshot. Recorded occurrences are covered by `SharedRecurrenceTests` and the import tests.
- The populated upgrade test builds older databases with the EF down migrations. These only remove later tables and columns, so they reproduce what an older release could store, but not data shapes that only older code wrote.
