# Operations runbook

[Documentation](README.md) · [Self-hosting](deployment.md)

Running a v2 deployment from [`deploy/compose.yaml`](deployment.md): monitoring, logs, PostgreSQL operations, backup and restore, maintenance, and what to do when something fails. The shorthand `penny` below stands for `docker compose -f deploy/compose.yaml`. Maintenance commands run inside the `api` container (`penny exec api dotnet Penny.Backend.Api.dll <command>`) with the runtime role and the receipt settings already configured. Nothing here puts a password on a command line.

## Monitoring

| Endpoint | Meaning | Use |
| --- | --- | --- |
| `GET /api/health` | The API process is serving (no dependency checks) | Liveness: restart only if this fails |
| `GET /api/ready` | Ready for traffic: PostgreSQL, schema, grants, extensions, import state and receipt storage all pass | Readiness, uptime alerting, load balancers |
| `GET /nginx-health` | nginx in `web` is up | `web` container health |

The `api` container's health check runs `dotnet Penny.Backend.Api.dll health-probe` (it calls its own `/api/ready`), so `docker compose ps` shows `unhealthy` whenever readiness fails. `/api/ready` returns 503 with `Retry-After: 5` and one of these messages. It never changes the database or leaks connection details:

| Code | Message starts with | Action |
| --- | --- | --- |
| `unavailable` | "Database is unavailable." | PostgreSQL down, unreachable, wrong credentials or TLS: see [database loss](#postgresql-is-down-or-unreachable) |
| `postgres-version` | "The backend requires PostgreSQL 18." | Point at a PostgreSQL 18 server |
| `runtime-role` | "Use a restricted runtime database role…" | The API is using a role that can create schemas or databases: use `penny_runtime` |
| `permissions` | "Runtime database role cannot read compatibility metadata…" | Grants missing: `penny run --rm migrate` |
| `search-extensions` | "Database is missing the pg_trgm or vector extension…" | [Extension missing](#extension-missing) |
| `schema` | "Database schema is missing or incompatible…" | Run `migrate` with this release, or you are running an older build against a newer schema ([rollback](deployment.md#roll-back)) |
| `import` | "SQLite import is incomplete…" | Finish `import-sqlite --resume`/`--verify` ([import](migration/postgresql.md#implemented-maz-52-commands)) |
| `receipt-storage` | "Receipt storage is not writable…" | [Receipt volume](#receipt-volume-not-writable-or-full) |
| `disk-space` | "Receipt storage is low on free disk space…" | [Receipt volume](#receipt-volume-not-writable-or-full) |

Suggested alerts: `/api/ready` non-200 for 2 minutes; any `"LogLevel":"Error"` or `"Critical"` line; PostgreSQL volume above 80% full; backups older than a day; `search-verify` or `receipts-verify` exiting non-zero in a scheduled run. With [telemetry](#telemetry-opentelemetry) on, also alert on `penny.job.failures`, `penny.job.lag` and 5xx `http.server.request.duration`; dashboards and client error monitoring are planned separately (MAZ-126, MAZ-128).

## Logs

The API writes one JSON object per line to stdout (`docker compose logs api`):

```json
{"Timestamp":"2026-11-09T23:58:27.113Z","EventId":180337991,"LogLevel":"Information","Category":"Penny.Backend.Api.Middleware.RequestCorrelationMiddleware","Message":"HTTP GET api/health responded 200 in 321.7 ms","State":{"Method":"GET","Route":"api/health","StatusCode":200,"ElapsedMilliseconds":321.6696,"{OriginalFormat}":"HTTP {Method} {Route} responded {StatusCode} in {ElapsedMilliseconds:0.0} ms"},"Scopes":[{"Message":"ConnectionId:0HNPUNLCAQ8QQ","ConnectionId":"0HNPUNLCAQ8QQ"},{"Message":"RequestId:abc-123","RequestId":"abc-123","{OriginalFormat}":"RequestId:{RequestId}"}]}
```

- **Correlation.** nginx sends its `$request_id` as `X-Request-Id`; the API keeps a well-formed id (1–64 of `A–Z a–z 0–9 - _ . :`) or issues one, uses it as the trace identifier, returns it in the `X-Request-Id` response header and puts `RequestId` in the scope of every line written for that request. Users reporting a failure can give you the response header. 500 errors log `API request failed (<ExceptionType>); request <RequestId>, trace <TraceId>`, where `<TraceId>` is the W3C trace id (`-` when the request was not traced); with [telemetry](#telemetry-opentelemetry) on, search traces by either id.
- **Access line.** One `Information` line per request with the method, the **route template** (for example `api/households/{id}`), status and duration. 499 means the client disconnected.
- **Never logged:** request or response bodies, query strings, concrete paths, cookies, bearer tokens, passwords, reset or invite codes, OIDC codes and tokens, APNs/Expo tokens, connection strings, SQL parameter values, exception messages and stack traces from request handling, search text and financial text. ASP.NET's own request logging (which includes raw paths) is turned off. Workers log counts, provider reason codes and exception types only. Tests enforce this for search, password reset and the access log.
- **Levels.** `Logging__LogLevel__Default=Warning` in `api.env` drops the access lines. Startup and shutdown lines come from `Microsoft.Hosting.Lifetime`.
- **Retention.** Configure your container runtime's log rotation (for Docker, the `json-file` driver's `max-size`/`max-file` options or a log shipper). Logs contain email-free operational data but should still be kept private.
- **Other services.** nginx writes its standard access log (client address, path, status) to stdout, and PostgreSQL its server log. The nginx access log contains concrete paths and query strings; restrict it accordingly.

## Telemetry (OpenTelemetry)

MAZ-127. The API can send **traces, metrics and logs** over OTLP to your OpenTelemetry Collector or Grafana Alloy (and from there to Tempo, Mimir/Prometheus and Loki). It is **off** unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set in `deploy/api.env`; then all three signals are on. Only the HTTP host exports; maintenance commands (`migrate`, `search-rebuild`, …) do not. The collector must be reachable from the `api` container (run it on the `penny` network or give its host address).

```sh
# deploy/api.env
OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4317
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=home
# OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic%20…   (a secret: keep api.env mode 0600)
```

| Setting | Default | Notes |
| --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset (telemetry off) | Absolute `http://` or `https://` URL without credentials, query or fragment. For `grpc`, the collector address (`:4317`); for `http/protobuf`, the base URL (`:4318`) to which `/v1/traces`, `/v1/metrics` and `/v1/logs` are appended |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `grpc` | `grpc` or `http/protobuf` |
| `OTEL_EXPORTER_OTLP_HEADERS` | none | Comma-separated `key=value` pairs (values URL-encoded) sent with every export, typically authentication. A secret |
| `OTEL_EXPORTER_OTLP_TIMEOUT` | 10000 | Milliseconds per export attempt |
| `OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_{ENDPOINT,PROTOCOL,HEADERS,TIMEOUT}` | the general value | Per-signal overrides. A per-signal endpoint is used as given (include `/v1/traces` etc. for `http/protobuf`) and needs the general endpoint set too |
| `OTEL_SERVICE_NAME` | `penny-backend` | Otherwise taken from `service.name` in `OTEL_RESOURCE_ATTRIBUTES`. `service.version` is the build version |
| `OTEL_RESOURCE_ATTRIBUTES` | none | `key=value,…`, for example `deployment.environment.name=home,service.instance.id=api-1` |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | `parentbased_always_on` | `always_on`, `always_off`, `traceidratio`, `parentbased_always_on`, `parentbased_always_off` or `parentbased_traceidratio`; the argument is a ratio from 0 to 1, for the ratio samplers only. Parent-based samplers follow the sampled flag of an incoming `traceparent` |
| `OTEL_METRIC_EXPORT_INTERVAL` | 60000 | Milliseconds between metric exports |
| `OTEL_BSP_SCHEDULE_DELAY` / `OTEL_BLRP_SCHEDULE_DELAY` | 5000 / 1000 | Milliseconds between span / log batch exports |
| `OTEL_SDK_DISABLED` | `false` | `true` turns telemetry off even with an endpoint |

Other standard `OTEL_*` variables the .NET SDK supports (batch sizes, attribute limits, compression, certificates) work as OpenTelemetry documents them. The settings in the table are checked at startup: an invalid endpoint, protocol, header list, timeout, sampler, ratio, interval or resource attribute list stops the API before it listens, with a message that names the variable and never echoes its value.

Export runs in the background, in batches. A slow, failing or unreachable collector never fails or delays a request: the exporter gives up after its timeout and drops that batch (tests check this against a collector that accepts connections and never answers). Nothing is buffered on disk, so a collector outage is a gap in your data, not a growing queue.

### What each signal contains

- **Traces.** One server span per request, named by method and **route template** (`PUT api/ledger`), with the standard HTTP server attributes (such as `http.request.method`, `http.route`, `http.response.status_code`, `url.scheme`, `server.address`, `network.protocol.version`, `user_agent.original`) and `penny.request_id` (the `X-Request-Id`). Its children are a span per PostgreSQL command (`db.query.text` is the parameterized statement; `db.namespace`, `server.address`) and a span per outgoing HTTP call to the OIDC provider, APNs or Expo (`url.full` is reduced to the origin, such as `https://api.push.apple.com`). Failed requests carry the error status and `error.type` (the status code). An incoming W3C `traceparent` is honoured, so a client's trace continues into the API, and outgoing provider calls pass the trace context on. Background workers trace each pass that claimed work as `push.delivery`, `push.receipts`, `search.embedding` or `recurrence` (attributes `penny.job`, `penny.job.items` and, on failure, `error.type`), with their SQL as children. `/api/health` and `/api/ready` requests and idle worker polls are not traced.
- **Metrics.** ASP.NET Core and Kestrel (`http.server.request.duration`, `http.server.active_requests`, `kestrel.*`, `aspnetcore.routing.*`, `aspnetcore.rate_limiting.*`, `aspnetcore.diagnostics.exceptions`), outgoing HTTP (`http.client.request.duration` and related), the .NET runtime (`dotnet.gc.*`, `dotnet.thread_pool.*`, `dotnet.process.*` and related) and the Npgsql pool (`db.client.connection.*`, `db.client.operation.duration`, pool name `penny-backend`). App metrics:

  | Metric | Attributes | Meaning |
  | --- | --- | --- |
  | `penny.auth.sign_ins` | `penny.auth.method` (`password`, `oidc`, `registration`), `penny.outcome` (`success`, `failure`), and on failure `error.type` (`invalid`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `error`) | Sign-in attempts |
  | `penny.rate_limit.rejections` | `penny.rate_limit.policy` (`auth`, `invites`, `search`) | Requests refused with 429 |
  | `penny.ledger.conflicts` | none | `PUT /api/ledger` refused with 409 (stale revision) |
  | `penny.household.joins` | `penny.outcome`, and on failure `error.type` | Invite-code joins |
  | `penny.job.lag` (seconds, histogram) | `penny.job` (`push.delivery`, `search.embedding`, `recurrence`) | Time from when work became due (push message created, embedding owed, start of the occurrence's UTC day) to when a worker claimed it |
  | `penny.job.items` | `penny.job` | Items claimed by worker passes |
  | `penny.job.failures` | `penny.job`, `error.type` (exception type name) | Failed items or passes; each is retried |
- **Logs.** The same structured `ILogger` records as the console, at the same levels (`Logging__LogLevel__*`): the formatted message, its template and structured values, the `RequestId` scope, and the trace and span ids of the request or worker pass that wrote them, so a Loki line links to its Tempo trace.

### Privacy guarantees

The [log rules](#logs) apply to every signal. Spans and metrics carry ids, route templates, status codes, fixed vocabularies and exception type names, never user content. No signal contains passwords, session or bearer tokens, cookies, invite or reset codes, OIDC codes or tokens, client secrets, APNs or Expo device tokens, connection strings, SQL parameter values, request or response bodies, query strings or concrete paths, search text, emails, names, notes or amounts. Exception messages and stack traces are not recorded on spans. Integration tests run registration, sign-in, ledger saves and conflicts, household invites and joins, password reset, search, OIDC sign-in and an unexpected error with telemetry on. They fail if any of those values appears in any exported span, metric or log record.

## Shutdown and restarts

`docker compose stop` sends SIGTERM. The API stops accepting connections, finishes in-flight requests for up to `Backend__ShutdownTimeoutSeconds` (30), stops the workers (in-flight leases expire and are taken over after a restart) and exits. Compose waits 45 seconds before killing it. PostgreSQL gets 60 seconds for a clean checkpoint. Restarting or recreating containers keeps all data in the named volumes. The smoke test checks sessions, households and receipts across `restart`, `down`/`up`, a PostgreSQL stop/start, and a restore.

## Connections and pool sizing

Each API process opens at most `Database__MaxPoolSize` (default 20) runtime connections. Pools start empty, idle connections close, and connect and command timeouts are 5 seconds. `migrate` uses one connection; `search-rebuild`/`search-verify` use two; receipt commands use the runtime pool. Keep `processes × MaxPoolSize + 5` below PostgreSQL's `max_connections` minus the connections reserved for the administrator. Diagnose as an administrator (`penny exec postgres psql -U postgres -d penny`):

```sql
-- Connections per role and state
SELECT usename, state, count(*) FROM pg_stat_activity WHERE datname = 'penny' GROUP BY 1, 2 ORDER BY 1, 2;
-- Long-running statements
SELECT pid, usename, now() - query_start AS running, state, left(query, 80) FROM pg_stat_activity
WHERE datname = 'penny' AND state <> 'idle' ORDER BY running DESC LIMIT 10;
SHOW max_connections;
```

## Disk

```sql
SELECT pg_size_pretty(pg_database_size('penny'));
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_statio_user_tables
WHERE schemaname = 'penny' ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;
```

```sh
penny exec api df -h /var/lib/penny/receipts
penny exec postgres df -h /var/lib/postgresql
```

Readiness fails with `disk-space` when the receipt volume has less than `Receipts__MinFreeMegabytes` (100) free. PostgreSQL itself stops accepting writes when its volume fills; readiness then reports `unavailable` or requests fail with 503. Grow the volume before it is full: WAL and vacuum need headroom.

## Back up

A complete backup is three things: the database dump, the receipt files, and the receipt master key (`PENNY_RECEIPT_KEY`, kept in your secret manager's own backup, never next to the data). **Dump the database first, then copy the receipt files.** The API writes a receipt's file before its row and never rewrites files, so every row in the dump has its file in the later copy. No write freeze is needed.

```sh
stamp=$(date -u +%Y%m%dT%H%M%SZ); umask 077
penny exec -T postgres pg_dump -U postgres -d penny --schema=penny --format=custom > "penny-$stamp.dump"
penny exec -T api tar -C /var/lib/penny/receipts -cf - . > "penny-receipts-$stamp.tar"
```

For an external PostgreSQL, run `pg_dump` with the PostgreSQL 18 client tools from a host that can reach it, using a password file (`PGPASSFILE`) and `sslmode=verify-full`. Store backups encrypted and off the host; they contain password hashes, sessions and financial data. Do not run `receipts-sweep` between the dump and the file copy.

The dump restores to its point in time. To lose nothing after it, enable WAL archiving and point-in-time recovery on the database (built into most managed services; for the bundled container use a tool such as pgBackRest or WAL-G against the `penny-postgres` volume) and back up the receipt volume at least as often.

## Restore

Restore into a **clean** environment, with the same release that took the backup (or a newer one) and the same receipt master key. This is exactly what the smoke test does on every CI run.

```sh
penny down                                   # keep volumes until the restore is verified elsewhere
# New project or new volumes: e.g. a fresh checkout, or `penny down -v` once copies are safe
penny up -d --wait postgres                  # first start creates roles, schema and extensions
penny exec -T postgres pg_restore -U postgres -d penny --clean --if-exists --exit-on-error < penny-$stamp.dump
penny run --rm --no-deps -T --entrypoint tar api -C /var/lib/penny/receipts -xf - < penny-receipts-$stamp.tar
penny up -d --wait                           # migrate (no-op or forward) + grants, then api and web
penny exec api dotnet Penny.Backend.Api.dll receipts-verify   # exit 0: every receipt decrypts
penny exec api dotnet Penny.Backend.Api.dll receipts-sweep    # drop files newer than the dump
penny exec api dotnet Penny.Backend.Api.dll search-verify     # exit 2 means rebuild (below)
```

The dump keeps object owners and grants, which the target's `init-roles.sh` roles satisfy. `migrate --grant-runtime` re-applies grants anyway. For a target without those roles, restore with `--no-owner --no-privileges`, then `ALTER SCHEMA penny OWNER TO penny_migrator`, reassign the tables (`REASSIGN OWNED`), and run `migrate`. Sessions survive a restore, so signed-in devices keep working; edits made after the backup are gone ([reconciliation](#write-reconciliation-after-a-rollback)).

**Restore drill.** At least monthly and before each upgrade that contains a migration, restore the latest backup into a separate Compose project (`docker compose -p penny-drill -f deploy/compose.yaml --env-file drill.env …` on a different `PENNY_PORT` and `PENNY_SUBNET`, with the production receipt key). Sign in, download a receipt, run the three verify commands, then `down -v` the drill.

## Maintenance

**Vacuum and statistics.** Autovacuum is on by default and sufficient. After a restore or a large import, run `ANALYZE` so the planner has statistics:

```sh
penny exec postgres psql -U postgres -d penny -c 'ANALYZE;'
```

**Index health.** The search indexes are the ones that grow with churn: `ix_search_documents_owner_trgm` and `ix_search_documents_document_trgm` (GIN, `pg_trgm`) and `ix_search_documents_embedding` (HNSW, pgvector). To rebuild one without blocking reads or writes, as the schema owner or administrator:

```sql
REINDEX INDEX CONCURRENTLY penny.ix_search_documents_embedding;
SELECT indexrelid::regclass, pg_size_pretty(pg_relation_size(indexrelid)) FROM pg_index
WHERE indrelid = 'penny.search_documents'::regclass;
-- An interrupted REINDEX CONCURRENTLY leaves an invalid index: find and rebuild it.
SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
```

Never create, drop or alter Penny's tables or indexes by hand; schema changes ship only as EF migrations applied by `migrate` ([changing the schema](migration/postgresql.md#changing-the-schema)).

**Search reconciliation.** Search documents and embeddings are derived data. `search-verify` is read-only and prints `{Documents, Missing, Orphaned, StaleText, PendingEmbeddings, StaleModel}`, exiting 0 when all are zero and 2 otherwise (pending embeddings are normal for a few seconds after writes). `search-rebuild [--user USER_ID]` recomputes documents and embeds what is missing. Run it after a restore that `search-verify` flags, after `import-sqlite`, and after an upgrade whose release notes say the search model or normalization changed. The embedding model is pinned in the image, so it changes only with a release.

```sh
penny exec api dotnet Penny.Backend.Api.dll search-verify
penny exec api dotnet Penny.Backend.Api.dll search-rebuild
```

**Receipts.** `receipts-verify` decrypts every receipt and reports `{Receipts, Verified, Missing, Corrupt, Unreferenced, Bytes}` (exit 2 on missing or corrupt files). `receipts-sweep [--dry-run]` removes unreferenced files older than an hour ([receipts](migration/receipts.md#commands)).

**Password resets.** `penny exec api dotnet Penny.Backend.Api.dll reset-password user@example.com` issues a one-time code ([password reset](migration/authentication.md#password-reset-maz-123)).

## PostgreSQL

### Roles, connections and TLS

| Role | Used by | Privileges |
| --- | --- | --- |
| `postgres` (administrator) | First initialization, extensions, backups, diagnostics | Superuser in the bundled container; never given to the API |
| `penny_migrator` | `migrate` only (`ConnectionStrings__Migration`) | Owns schema `penny`; creates and alters its objects; applies the runtime grants |
| `penny_runtime` | The API and maintenance commands (`ConnectionStrings__Postgres`) | DML on `penny` tables and sequences; read-only migration history and import checkpoint; no DDL. Readiness refuses a role that could change schema |

Connection strings are Npgsql key/value strings (`Host=…;Port=…;Database=…;Username=…;Password=…;SSL Mode=…`). Compose assembles them from `deploy/.env`. Use `SSL Mode=VerifyFull` (plus `Root Certificate=` for a private CA) for every server outside the Compose network. The bundled container is reachable only on the internal network and uses no TLS. Penny forces pooling bounds, connect, command and cancellation timeouts, disables parameter logging and error detail, and disables Kerberos/GSS negotiation unless `GSS Encryption Mode` is set explicitly.

### Migrations and locks

`migrate` checks PostgreSQL 18 and the extensions, takes the session advisory lock `0x50454E4E59` (also used by `import-sqlite`), refuses a database with migrations unknown to the build, applies pending migrations (each in its own transaction), then runs `grant-runtime.sql`. If a migration seems stuck:

```sql
-- The advisory lock shows as classid 80, objid 1162760793
SELECT l.pid, a.usename, now() - a.backend_start AS connected, a.state FROM pg_locks l JOIN pg_stat_activity a USING (pid)
WHERE l.locktype = 'advisory' AND l.classid = 80 AND l.objid = 1162760793;
```

The lock belongs to that session and is released when it ends. Terminate it (`SELECT pg_terminate_backend(<pid>)`) only after confirming no migration or import is still running. The interrupted migration's transaction rolls back.

### Extensions

`pg_trgm` (keyword and typo matching) and `vector` (pgvector 0.8 or later, meaning search) must exist in `public` before `migrate`. The bundled image ships both (pgvector 0.8.7), and `init-roles.sh` creates them on first start. For an existing database: `CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS vector;` as administrator. Check:

```sql
SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_trgm', 'vector');
SELECT name, default_version FROM pg_available_extensions WHERE name IN ('pg_trgm', 'vector');
```

To upgrade pgvector within a release: `ALTER EXTENSION vector UPDATE;` after the server has the newer library.

### Managed PostgreSQL hosts

Penny needs PostgreSQL 18, `pg_trgm`, pgvector 0.8+, the ability to create two login roles and a schema owned by one of them, and session-level advisory locks (no transaction-mode pooler in front of `migrate`). Major cloud providers advertise both extensions on their PostgreSQL services, but support for PostgreSQL 18 and the exact pgvector version varies by provider, region and date. **This has not been verified against any specific managed host.** Before choosing one, create a test database there and check `pg_available_extensions` (above), then run a [restore drill](#restore) against it. Record what you find in your own runbook. On services where the administrator isn't a superuser, extensions are created through the provider's mechanism (often an allow-list parameter followed by `CREATE EXTENSION` as the provided admin role).

### Version and upgrade policy

- **PostgreSQL major:** 18 only. Readiness and `migrate` reject other majors. A Penny release will announce support for a new major; until then, don't upgrade the server's major version.
- **PostgreSQL minor:** the bundled image is pinned by digest and moves only in a Penny release (the release notes say so). On an external server, apply minor releases as your provider recommends; they need no Penny change.
- **Major upgrade (when supported):** take a backup, run a [restore drill](#restore) on the new major, then either `pg_dump`/`pg_restore` into a new cluster or `pg_upgrade` it. Update `PENNY_DB_*`, run `migrate`, and verify readiness. Keep the old cluster read-only until verified.
- **Penny releases:** forward-only. Any v2 release migrates any earlier v2 database, and no release downgrades. Deploy exact image tags and keep the previous tags and the pre-upgrade backup until the new release is verified ([upgrade](deployment.md#upgrade)).

### Secret rotation

- **Runtime or migration password:** `ALTER ROLE penny_runtime PASSWORD '…';` as administrator, update `deploy/.env`, then `penny up -d --wait` (recreates the services that use it). Existing pooled connections keep working until they close.
- **Administrator password:** `ALTER ROLE postgres PASSWORD '…';` and update `.env` (the image reads it only on first initialization).
- **Receipt master key:** not rotatable by design. Every receipt's key is derived from it. Protect and back it up.
- **APNs key or OIDC client secret:** replace the value in `api.env` and recreate `api`.

## Write reconciliation after a rollback

Restoring a backup discards everything written after it. Rolling forward is preferred. If you must roll back across a migration or recover from a bad release:

1. **Freeze writes** (stop `web` and `api`) and take a dump of the current database ("post-incident dump") plus the receipt volume, even if the data is suspect.
2. **Restore** the last good backup ([restore](#restore)) with the matching images.
3. **Find what was lost.** Restore the post-incident dump into a scratch database (`createdb penny_incident`, `pg_restore --no-owner --no-privileges`) and compare against the restored database by time: `household_audit.created_at` lists every shared-expense, reimbursement and membership change; `ledgers.revision` shows which personal ledgers changed; `receipts.created_at`, `users.created_at` and `sessions.created_at` show new receipts, accounts and sign-ins.
4. **Reconcile.** Personal ledgers: the apps keep their own copy. A device that saved after the backup expects a newer revision than the restored one, so its next save gets 409 ([ledger sync](migration/ledger.md)); tell affected users to check their recent personal entries after the app resyncs. Shared expenses and reimbursements: re-enter them from the audit history in the scratch database (as the users involved, or with their agreement). New accounts and receipts: affected users sign up or upload again. There is no automatic merge.
5. **Tell users** the window of lost writes. Drop the scratch database once reconciled, and keep the post-incident dump through your retention period.

For the one-time SQLite cutover, the rules are different: before writes reopen on v2, roll back to the untouched SQLite source; after that, recovery is forward-only ([cutover](migration/postgresql.md#cutover-and-forward-only-recovery)). Keep the sealed SQLite snapshot, its hash and the legacy volume through the observation window.

## Failure runbooks

### PostgreSQL is down or unreachable

`/api/ready` returns 503 "Database is unavailable", `/api/health` stays 200, requests that need the database fail with 503, and the workers retry on their next poll. Check `penny ps`, `penny logs postgres`, disk space on the PostgreSQL volume, credentials (a changed password in `.env` without `ALTER ROLE`), and TLS settings for an external server. When the database returns, readiness recovers on its own without a restart (tested by the smoke suite).

### Receipt volume not writable or full

Readiness reports `receipt-storage` or `disk-space`, and uploads fail. The volume must be owned by uid 1654 with mode 0700. Repair it with a one-off root container that gets back only the ownership capabilities: `penny run --rm --no-deps --user 0 --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE --entrypoint sh api -c 'chown -R 1654:1654 /var/lib/penny/receipts && chmod 0700 /var/lib/penny/receipts'`. For a bind mount instead of the named volume, `chown 1654:1654` the host directory. Free or grow space, then readiness recovers without a restart.

### Runtime grants missing

Readiness reports `permissions` after a manual restore or a migration applied without grants. Run `penny run --rm migrate`, which re-applies `grant-runtime.sql` idempotently.

### Extension missing

Readiness reports `search-extensions` and `migrate` refuses to run. Create the extension as administrator ([extensions](#extensions)). If an extension was dropped with `CASCADE`, the search indexes that depend on it were dropped too and are not recreated by `migrate`: [restore](#restore) the last backup. Never `DROP EXTENSION … CASCADE` on a live database.

### Migration failed

The `migrate` container exits non-zero and Compose does not start or recreate the API. `penny logs migrate` shows a redacted reason: PostgreSQL version, missing extensions, the lock held by another run, a newer schema than this build, or connectivity. Fix the cause and `penny up -d --wait` again; completed migrations are recorded and not repeated.
