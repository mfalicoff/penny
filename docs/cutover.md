# Cutover from Node/SQLite to .NET/PostgreSQL

[Documentation](README.md) · [Self-hosting](deployment.md) · [Operations runbook](operations.md)

This is the operator checklist for moving an existing Penny server from the legacy Node/SQLite deployment (root `compose.yaml`) to the v2 stack (`deploy/compose.yaml`) **behind the same address**, with one writer at every moment. It covers preparation, the maintenance window, go/no-go gates, rollback, the observation window, the client compatibility window, and when the Node server can be retired. The storage contract behind it (import modes, reconciliation, forward-only recovery) is in [PostgreSQL storage, import and recovery](migration/postgresql.md#cutover-and-forward-only-recovery).

Every step here is exercised on every image build by the [cutover drill](#the-cutover-drill), using the release images and synthetic data.

## Rules

1. **One writer.** Node and .NET never accept writes at the same time. Writes stop on Node before the snapshot and reopen on .NET only after every gate passes. There is no dual write, sync or replay between them.
2. **The legacy volume is never written by the cutover.** The `cutover` service mounts it read-only. The sealed snapshot, the PostgreSQL target and the receipt volume are the only things the cutover creates.
3. **Before writes reopen on .NET, rollback is cheap:** throw away the target, start Node on the untouched volume. **After writes reopen, recovery is forward-only:** fix forward, or PostgreSQL point-in-time recovery plus the receipt backup. Never restore the old SQLite snapshot over accepted data, and never export PostgreSQL back to SQLite.
4. **No real data in tickets or logs.** The evidence you record is exit codes, counts, hashes and pass/fail, never row values, emails or tokens.

## Roles and evidence

Name before the window: the **operator** (runs the commands), the **decider** (calls go or no-go at each gate; may be the same person), and how users are told about downtime and password resets.

Record in the issue or your own runbook, per run: date, release tags (`PENNY_API_IMAGE`, `PENNY_WEB_IMAGE`, legacy image), the sealed SHA-256, the exit code of every command below, the `import-sqlite` JSON report (row counts and per-table digests; no row values), `receipts-verify` and `search-verify` output, and the result of each gate. The drill writes the same shape to `cutover-drill-report.{json,md}`.

## Settings: legacy to v2

Move these from the legacy root `.env` into `deploy/.env` (copied from `deploy/.env.example`) and `deploy/api.env` before the window. The public origin and the OIDC redirect URIs must stay **exactly** as they are, or browser cookies and single sign-on break at the switch.

| Legacy (`.env`) | v2 | Notes |
| --- | --- | --- |
| `PORT` (3001) | `PENNY_BIND` / `PENNY_PORT` (8080) | Your TLS proxy points at this port after the switch |
| `CORS_ORIGINS` | `PENNY_PUBLIC_ORIGIN` | Same origin(s), comma-separated |
| `COOKIE_SECURE` | `PENNY_SECURE_COOKIES` | `true` for any `https://` origin |
| `ALLOW_REGISTRATION` | `Auth__AllowRegistration` (`api.env`) | |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URIS`, `OIDC_LABEL`, `OIDC_ALLOW_REGISTRATION` | `Oidc__Issuer`, `Oidc__ClientId`, `Oidc__ClientSecret`, `Oidc__RedirectUris`, `Oidc__Label`, `Oidc__AllowRegistration` (`api.env`) | Imported identities keep signing in by `(issuer, subject)`, so the issuer must be byte-identical |
| (none) | `PENNY_RECEIPT_KEY` | New. Back it up in your secret manager **before** the import: every imported receipt is encrypted with it |

Find the legacy volume name and confirm the file is there (the root `compose.yaml` names it `<project>_penny-data`, usually `penny_penny-data`):

```sh
docker volume ls | grep penny-data
export PENNY_LEGACY_VOLUME=penny_penny-data
```

Both the legacy root Compose file and `deploy/compose.yaml` can end up in the same Compose project (`penny`). Then Compose calls the legacy container an orphan. **Never pass `--remove-orphans`** to the v2 stack until Node is retired, or Compose deletes the legacy container. The volume would survive, but the container would be gone.

Shorthands used below:

```sh
penny="docker compose -f deploy/compose.yaml"
cutover="docker compose -f deploy/compose.yaml -f deploy/compose.cutover.yaml"
legacy="docker compose -f compose.yaml"          # however you run the legacy server
```

## Before the window

- [ ] **Pin the release.** Exact `PENNY_API_IMAGE`/`PENNY_WEB_IMAGE` tags in `deploy/.env`, a checkout of the same tag, and the drill passed in that tag's image build (`Backend images` workflow, job summary "Cutover drill").
- [ ] **Do not use the v2 stack yet.** The import needs an **empty** target. Nobody may register or sign in on v2 before the window. Keep its port private and the `api` service stopped.
- [ ] **Point-in-time recovery is configured** on PostgreSQL (WAL archiving: managed service PITR, or pgBackRest/WAL-G for the bundled container), and you have done one restore with it ([operations](operations.md#back-up)). This is the only recovery path after writes reopen.
- [ ] **Rehearse on a copy of production** (next section) with the pinned release. Record its timings to size the window.
- [ ] **Tell users** the window (expect minutes to an hour, from your rehearsal) and that:
  - devices keep working offline and upload their personal edits afterwards. Shared-expense and household actions fail during the window and must be retried;
  - **email/password accounts must reset their password once.** Legacy scrypt hashes cannot be verified by .NET. Signed-in devices stay signed in until their session ends (at most 30 days), but a new password sign-in needs an operator-issued reset code ([password reset](migration/authentication.md#password-reset-maz-123)). Say how codes will reach them. OIDC accounts are unaffected.
- [ ] Decide the **observation window** (default: 14 days) and the **retention** of the sealed snapshot and legacy volume (at least the observation window plus your backup retention).

### Rehearsal on a production copy

Run it on the production host or a copy of it, in a separate Compose project with its own port, subnet, database and receipt volume, so nothing touches the real v2 volumes.

```sh
# 1. A consistent copy of the legacy volume: stop Node for the few seconds of the copy.
$legacy stop
docker volume create penny-rehearsal-legacy
docker run --rm -v "$PENNY_LEGACY_VOLUME":/from:ro -v penny-rehearsal-legacy:/to --entrypoint sh <legacy image> -c 'cp -a /from/. /to/'
$legacy start

# 2. A throwaway v2 project on the copy (its own .env with a new receipt key).
cp deploy/.env.example rehearsal.env && chmod 600 rehearsal.env   # fill in fresh secrets
printf 'PENNY_PUBLIC_ORIGIN=http://localhost:18080\nPENNY_SECURE_COOKIES=false\nPENNY_PORT=18080\nPENNY_SUBNET=172.31.200.0/24\nPENNY_API_IMAGE=…\nPENNY_WEB_IMAGE=…\nPENNY_LEGACY_VOLUME=penny-rehearsal-legacy\n' >> rehearsal.env
rehearsal="docker compose -p penny-rehearsal -f deploy/compose.yaml -f deploy/compose.cutover.yaml --env-file rehearsal.env"
```

Then run [the window](#the-window) steps 3–8 with `$rehearsal` in place of `$cutover` and `$penny`, and skip the switch. Check, as the rehearsal's gates:

- every command exits 0, and `import-sqlite --verify` reproduces the import report. Its reconciliation compares **every mapped column of every row** and decrypts every receipt, so this proves the data is complete;
- your own account signs in after a reset code, and its ledger, households, months and a receipt match what Node shows;
- interrupt one import (Ctrl-C or `docker kill` during `import-sqlite`), check `/api/ready` reports `import`, then `import-sqlite … --resume` completes and `--verify` passes;
- note the import, `search-rebuild` and total times.

Remove it afterwards: `$rehearsal --profile bundled-postgres --profile cutover down -v` (a `--profile` flag replaces `COMPOSE_PROFILES`, so name both) and `docker volume rm penny-rehearsal-legacy`. Never use `-v` with the production project.

## The window

Each numbered step ends with its gate. A failed gate before step 9 means **no-go: [roll back](#rollback-before-writes-reopen)**. Replace `HASH` with the SHA-256 printed in step 3.

1. **Freeze.** Make the public address return a maintenance response (or stop forwarding it), then stop Node cleanly. `SIGTERM` closes the database, which checkpoints the WAL:

   ```sh
   $legacy stop --timeout 30
   docker run --rm -v "$PENNY_LEGACY_VOLUME":/data:ro --entrypoint ls <legacy image> -la /data
   ```

   Gate: the container is stopped, and `/data` has `penny.sqlite` with **no** `penny.sqlite-wal`/`-shm`. A WAL file means Node did not shut down cleanly: start it, wait until healthy, and stop it again. Record the source hash, `SOURCE`:

   ```sh
   docker run --rm -v "$PENNY_LEGACY_VOLUME":/data:ro --entrypoint sha256sum <legacy image> /data/penny.sqlite
   ```

2. **Prepare PostgreSQL.**

   ```sh
   $penny up -d --wait postgres
   $penny run --rm migrate
   ```

   Gate: `migrate` prints "Database migration complete." and "Runtime grants applied."

3. **Copy and seal.** The legacy database is in WAL mode, which SQLite cannot open from the read-only legacy mount. So copy the cleanly closed file (step 1 proved there is no WAL to lose) into `penny-cutover`, then seal the copy:

   ```sh
   $cutover run --rm --entrypoint sh cutover -c 'cp /var/lib/penny/legacy/penny.sqlite /var/lib/penny/cutover/source.sqlite && sha256sum /var/lib/penny/cutover/source.sqlite'
   $cutover run --rm cutover snapshot-sqlite /var/lib/penny/cutover/source.sqlite /var/lib/penny/cutover/sealed.sqlite
   ```

   Gate: the copy's hash equals `SOURCE`, and `snapshot-sqlite` exits 0. Record its printed SHA-256 as `HASH`. The sealed file is rewritten without a journal, so `HASH` differs from `SOURCE`; that is expected. `snapshot-sqlite` never overwrites, so a second attempt uses new names (`source-2.sqlite`, `sealed-2.sqlite`).

4. **Dry run.** `$cutover run --rm cutover import-sqlite /var/lib/penny/cutover/sealed.sqlite --sha256 HASH --dry-run`

   Gate: exit 0. A validation failure (`membership-mismatch`, a foreign key, a split sum, an unknown schema) is a no-go: keep the snapshot for diagnosis and follow [failure recovery](migration/postgresql.md#implemented-maz-52-commands).

5. **Import.** `$cutover run --rm cutover import-sqlite /var/lib/penny/cutover/sealed.sqlite --sha256 HASH > import-report.json`

   Gate: exit 0. If it is interrupted, run the same command with `--resume`. If the result is unknown (lost connection at commit), check `SELECT status FROM penny.sqlite_import` and use `--verify`. Never clear the checkpoint.

6. **Verify.** `$cutover run --rm cutover import-sqlite /var/lib/penny/cutover/sealed.sqlite --sha256 HASH --verify`

   Gate: exit 0 and the same table report as step 5.

7. **Start the API (not yet public) and rebuild search.**

   ```sh
   $penny up -d --wait
   $penny exec api dotnet Penny.Backend.Api.dll search-rebuild
   $penny exec api dotnet Penny.Backend.Api.dll search-verify     # repeat until it exits 0 (pending embeddings drain)
   $penny exec api dotnet Penny.Backend.Api.dll receipts-verify   # exit 0; Verified = Receipts
   ```

   Gate: `/api/ready` on the v2 port is 200, `search-verify` exits 0, and `receipts-verify` shows nothing missing or corrupt.

8. **Smoke on the v2 port** (`http://127.0.0.1:8080`, or an SSH tunnel), still frozen:
   - an OIDC account and a reset password account sign in (`reset-password EMAIL` issues the code);
   - a device or browser that was signed in before the window still is (imported sessions, bearer and cookie);
   - a ledger, a household with its month recap and audit, and a receipt look as they did on Node;
   - search finds a known entry.

   Gate: all of the above. Optionally pre-issue reset codes now. List the accounts that need one as administrator, without printing anything else: `SELECT email FROM penny.users WHERE password <> '' AND salt <> '';`

9. **Switch and reopen.** Point the public address's proxy at the v2 `web` port (`PENNY_BIND:PENNY_PORT`) instead of Node's 3001, and remove the maintenance response. **From here, recovery is forward-only.**

   Gate: `https://<origin>/api/ready` is 200; a write (add and delete an entry) succeeds through the public address; logs show no errors.

10. **Back up and retain.** Take the first v2 backup ([back up](operations.md#back-up)), and export the sealed snapshot next to the legacy volume:

    ```sh
    $cutover run --rm --no-deps -T --entrypoint cat cutover /var/lib/penny/cutover/sealed.sqlite > sealed.sqlite   # umask 077
    sha256sum sealed.sqlite      # equals HASH
    ```

    Keep `sealed.sqlite`, `HASH`, the legacy volume and the legacy image through the retention period. Disable the legacy service's restart policy so it cannot start by itself and accept writes.

## Go/no-go

| Gate | No-go when |
| --- | --- |
| Freeze | Node is still serving, a WAL file remains, or anything else writes the SQLite file |
| Migrate | `migrate` fails (version, extensions, lock, newer schema) |
| Seal | The snapshot fails, or its hash changes between steps |
| Import and verify | Any non-zero exit; any table count or digest differs between import and `--verify`; a receipt fails to decrypt |
| Search | `search-verify` does not reach 0 |
| Accounts | An OIDC sign-in, an imported session or a redeemed reset code fails |
| Data | A ledger, household, month, audit or receipt differs from Node; any authorization leak |
| Time | The window exceeds the time announced plus your margin before step 9 |

Rollback triggers **after** step 9 (writes reopened) do not lead back to Node. They lead to a forward fix or to [recovery after writes reopen](#recovery-after-writes-reopen): readiness failing for more than a few minutes, sustained 5xx in the access log, missing or wrong data reported by users, or any authorization leak.

## Rollback before writes reopen

Any no-go up to and including step 8:

```sh
$penny down -v                    # discards the PostgreSQL target and the receipt volume; penny-cutover (the failed snapshot) stays
docker run --rm -v "$PENNY_LEGACY_VOLUME":/data:ro --entrypoint sha256sum <legacy image> /data/penny.sqlite   # equals SOURCE
$legacy start                     # Node resumes on the untouched volume
```

Then point the address back at Node (if it was moved) and lift the maintenance response. Users see the same data as before the window, because nothing changed it. Devices upload their pending edits as usual. The next attempt starts again at step 1 with a **new** snapshot, because Node accepts writes again. `down -v` is right here only because the v2 project has never accepted a user write. **Never run it after step 9.**

With an external PostgreSQL, drop and recreate the target database (or create a new one) instead of `down -v`, and empty or replace the receipt volume.

## Writes during the window and after a rollback

- **Personal ledgers.** The apps keep an offline copy with a base revision. A save during the freeze fails, and the edit stays pending on the device. After the switch (or a rollback), the device saves against its base revision. If another device saved first, it gets 409, re-reads, merges its own edits onto the newer ledger and saves again. The import preserves revisions exactly, so this works across the switch. Nothing is lost on either side.
- **Shared expenses, households, settlement, receipts, devices.** These are not queued on the device. During the window the request fails and the user retries afterwards. After a rollback before reopen there is nothing to reconcile: .NET accepted no writes.
- **Shared recurring rules** are not run while frozen. The first .NET worker run catches up every due occurrence, once.
- **Push notifications** queued in the legacy outbox are imported. Messages older than 24 hours expire instead of being sent late.

## Recovery after writes reopen

Fix forward with a new release when you can. To undo damage, use PostgreSQL point-in-time recovery to a moment before the incident, plus the receipt volume backup taken after the matching database backup ([operations](operations.md#back-up)), then [reconcile](operations.md#write-reconciliation-after-a-rollback) writes accepted after that moment. This path is rehearsed by `PointInTimeRecoveryTests`. Node is not a recovery target once .NET has accepted a write: its data is older, and the two cannot be merged.

## Observation window

For the observation window (default 14 days) after step 9:

- watch `/api/ready`, error log lines, 5xx and 409 rates, and receipt and PostgreSQL disk ([monitoring](operations.md#monitoring));
- run `receipts-verify` and `search-verify` daily, and check backups and WAL archiving are current;
- issue reset codes as password users ask, and track how many imported password accounts have not reset yet;
- keep Node stopped, with its volume, image and the sealed snapshot retained.

## Compatibility window

What existing clients get after the switch, and for how long:

| Client or credential | After the switch | Until |
| --- | --- | --- |
| Current Expo iOS app on the same address | Supported: same routes, payloads, errors, ledger v1–v4, `penny_session` cookie and bearer tokens | Replaced by the native iOS app (MAZ-98) |
| Expo Android app | Supported by the same API until it drops the legacy routes (MAZ-131), with no fixes | Retired in MAZ-98 with no migration path ([Android retirement](ios-ipa.md#android-retirement)) |
| Expo web app (browsers) | Replaced by the TanStack web app in the `penny-web` image on the same origin (MAZ-97): legacy URLs, cookie sessions and unsynced `localStorage` edits carry over ([web app](deployment.md#the-web-app)) | Retired in MAZ-97 |
| Signed-in sessions | Keep working, unchanged | Their legacy expiry (at most 30 days after their last sign-in) |
| Email/password accounts | Must redeem an operator-issued reset code once | Indefinitely: the scrypt hash stays stored but never verifies |
| OIDC accounts | Unchanged, with the same issuer, client and redirect URIs | — |
| Expo push tokens | Delivered by .NET through Expo (`Push__Expo__Enabled=true`) | Expo retirement gates ([push](migration/push.md#token-and-provider-migration)) |
| Legacy compatibility code in .NET | Kept | Reviewed in MAZ-131 once the old clients are retired |

## Retiring the Node server

Retire Node only after **all** of these hold:

1. The observation window has passed with no rollback trigger, and no data issue is open.
2. At least one v2 backup has been restored in a drill ([restore drill](operations.md#restore)), and PITR is current.
3. `receipts-verify` and `search-verify` have been clean daily, and readiness has held.
4. The retention decision for the sealed snapshot and legacy volume is recorded.

Then remove the legacy container and service (now `--remove-orphans` is safe), stop publishing or deploying the legacy image, and remove the `penny-cutover` volume (`docker volume rm penny_penny-cutover`) once the sealed snapshot is archived elsewhere. Delete the legacy volume and the archived snapshot at the end of their retention. Stop passing `deploy/compose.cutover.yaml`. The `sqlite_import` checkpoint row stays: readiness reads it, and a later release removes it with the legacy compatibility code (MAZ-131).

## The cutover drill

`scripts/cutover-drill.mjs` runs this checklist against the release images on synthetic data, behind a local stand-in for your proxy that can freeze and switch the address:

1. Legacy serves the address. Synthetic users write ledgers, receipts, a household with every split mode, a share payment, a shared rule, a trip a member left, a cookie session, a signed-out session and an Expo device. One device keeps edits it has not uploaded.
2. Freeze: the address returns 503, Node stops cleanly, no WAL remains.
3. Attempt 1: migrate, copy and seal, dry run, import, verify. Then a deliberate no-go: `down -v` discards the target and receipts, the source hash is unchanged, Node resumes and every recorded read is unchanged, and Node accepts writes again.
4. Attempt 2: freeze, seal the changed source, import, verify, start the API, search rebuild and verify, receipts verify. Before the switch, every recorded legacy read (60) must equal .NET's with the imported bearer sessions, except for documented differences ([parity report](migration/parity-report.md#triage)). The cookie session works, the signed-out session stays refused, receipts are byte-identical, search works and the scrypt password is refused.
5. Switch: the revision continues, another device saves, then the returning offline device gets 409, merges with the shipped client merge (`src/domain/merge.ts`) and saves. Both devices' edits survive. Cookie writes from the public origin, a shared expense, Expo device registration and a redeemed reset code all work.
6. API and PostgreSQL restarts keep everything. The sealed snapshot exports with its hash, and the legacy volume is unchanged.

```sh
docker build -t localhost/penny-legacy:dev .
docker build -t localhost/penny-api:dev apps/backend
docker build -t localhost/penny-web:dev -f deploy/web/Dockerfile .
node scripts/cutover-drill.mjs     # PENNY_DRILL_{LEGACY,API,WEB}_IMAGE override the tags
```

It prints one line per gate, writes `test-results/cutover-drill/cutover-drill-report.{json,md}` (GO or NO-GO, every step's exit code and time, every gate), and exits 1 on a no-go. `PENNY_DRILL_KEEP=1` keeps a failed run for inspection; `PENNY_COMPOSE` and `PENNY_DOCKER` select the CLIs (Podman works). CI runs it in the `Backend images` workflow on amd64.

What the drill does not cover, and where it is covered instead: an interrupted import and resume (`SqliteImportTests`, and the production-copy rehearsal above), OIDC sign-in of an imported identity (`ImportedOidcTests`), failed extension or migration creation (`MigrationTests`, `deploy-smoke.mjs`), point-in-time recovery after accepted writes (`PointInTimeRecoveryTests`), clock-dependent history across months (the full-stack [cutover rehearsal](migration/parity-report.md#gates)), and dump/restore of the v2 stack (`deploy-smoke.mjs`).

## Release notes (v2.0.0)

Ready to paste into the release that ships the cutover:

> **Penny 2.0 moves the server to .NET and PostgreSQL.** Upgrading an existing server is a one-time, offline migration: follow `docs/cutover.md`. The app address, sign-in sessions, OIDC accounts, data, receipts and notifications carry over. Current apps keep working without an update.
>
> - **Action required for email/password accounts:** passwords set on the old server can't be checked by the new one. Users who sign in with a password need a one-time reset code from their server operator (`reset-password EMAIL`); devices already signed in stay signed in until their session ends.
> - Configuration moves from the root `.env` to `deploy/.env` and `deploy/api.env` (see the mapping in `docs/cutover.md`). A new receipt encryption key is generated: back it up.
> - PostgreSQL 18 with `pg_trgm` and pgvector is required, either the bundled container or your own.
> - Search now matches typos and meaning. It is rebuilt during the migration.
> - The Node server and its image stay available, unchanged, until the observation window ends. Rolling back is supported only before the new server accepts its first write.
