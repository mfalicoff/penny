# Penny ASP.NET Core foundation

MAZ-51 provides a separate controller-based .NET 10 service; MAZ-52 adds the EF Core product schema and migrations and the encrypted receipt file store. MAZ-53 adds password registration/login/me/logout (ASP.NET Core Identity password hashes), cookie and bearer sessions, origin/CORS policy and sign-in rate limiting ([authentication](../../docs/reference/authentication.md)). MAZ-54 adds OIDC sign-in (discovery, Authorization Code with S256 PKCE, server-side code exchange, ID token validation, no automatic email linking) with pending attempts stored in PostgreSQL. MAZ-123 adds an operator-issued password reset (`reset-password EMAIL` maintenance command and `POST /api/auth/password-reset`) so a user who cannot sign in can set a new password ([password reset](../../docs/reference/authentication.md#password-reset-maz-123)). MAZ-55 adds `GET`/`PUT /api/ledger` over the typed v4 ledger: validation, receipt/account/household-currency checks and atomic compare-and-increment with 409 conflicts ([ledger sync](../../docs/reference/ledger.md)). MAZ-56 adds household and shared-trip membership: create, list, detail, rename, trip dates, hashed expiring invite codes, join, leave, removal and archive with settlement and creator rules, transactional and locked against concurrent joins and ledger currency changes ([households](../../docs/reference/households.md)). MAZ-57 adds shared expenses: list, read, create, update/move, soft delete and individual share payments with integer-cent equal/exact/percentage splits, date-based participants, payer-only accounts, revisions and transactional audit/outbox rows, plus the read-only personal projection `GET /api/households/projection` ([shared expenses](../../docs/reference/shared-expenses.md)). MAZ-59 adds shared recurring rule list/create/update/delete and a background runner that records due occurrences with PostgreSQL leases, one transaction per occurrence (expense, audit, push outbox, search document) and safe restarts and multiple workers ([shared recurrence](../../docs/reference/shared-recurrence.md)). MAZ-121 adds `POST /api/v1/search/transactions`: normalized substring, typo (`pg_trgm`) and meaning (multilingual-e5-small embeddings on the CPU, pgvector HNSW) search over personal entries and visible shared expenses, documents written in the ledger and expense transactions, a background embedding outbox worker, and `search-rebuild`/`search-verify` commands ([search](../../docs/reference/search.md)). MAZ-58 adds month recaps (`GET /api/households/{id}/months/{month}`: per-month balances, full suggested transfers, overdue months), monthly reimbursements with the UTC month-end cutoff and household-locked, duplicate-safe writes, and the audit history `GET /api/households/{id}/audit` with read-time redaction ([settlement](../../docs/reference/settlement.md)). MAZ-62 adds guarded test controls and a one-command disposable environment (pinned PostgreSQL container plus this API) with seeds and a local OIDC provider ([test environment](../../docs/reference/test-environment.md)). MAZ-60 and MAZ-61 add receipt upload/download and push delivery; APNs is the only push provider. MAZ-63 packages the service for self-hosting: multi-architecture API and web images, production Compose with a one-shot `migrate --grant-runtime`, correlation ids and redacted JSON access logs, receipt-storage readiness, a `health-probe` container check and a production-container smoke test ([self-hosting](../../docs/deployment.md), [operations runbook](../../docs/operations.md)). MAZ-127 adds OpenTelemetry traces, metrics and logs over OTLP, off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set, with the logging redaction rules applied to every signal ([telemetry](../../docs/operations.md#telemetry-opentelemetry)). MAZ-128 adds a reference Grafana stack for operators (Alloy, Loki, Tempo, Prometheus, Grafana) with client ingest for the web and iOS apps, six dashboards and example alerts ([observability](../../docs/observability.md)). MAZ-125 extracts receipt text on the server (poppler for embedded PDF text, Tesseract for photos and scans, as child processes over stdin/stdout) in a leased, retried background job, stores it unencrypted with its status and engine, and makes it searchable by text, typo and meaning under the receipt's own visibility, with separate chunk embeddings and a `receipts-ocr` backfill command ([receipt OCR](../../docs/operations.md#receipt-text-ocr)). The EF migrations were squashed into one `InitialSchema` ([upgrading a database from before the squash](#upgrading-a-database-from-before-the-squash)).

## Toolchain and layout

Install SDK **10.0.403** (pinned without roll-forward), Node 24 for the model download script, the web app and the root checks, and Docker or compatible Podman for PostgreSQL. Packages are centralized in `Directory.Packages.props`, locked per project, and restored only from nuget.org. Current pins: Npgsql 10.0.3, Npgsql.EntityFrameworkCore.PostgreSQL 10.0.3, EF Core Relational/Design and the `dotnet-ef` tool 10.0.14, ASP.NET OpenAPI/MVC Testing 10.0.14, Scalar 2.19.0, Microsoft.IdentityModel.Protocols.OpenIdConnect and JsonWebTokens 8.23.0 (OIDC discovery and ID token validation), xUnit v3 4.0.2, Testcontainers 4.16.0, CSharpier 1.3.0, and for search (MAZ-121) Pgvector.EntityFrameworkCore 0.3.0, Microsoft.ML.OnnxRuntime 1.31.1, Microsoft.ML.Tokenizers 2.0.1 and System.Numerics.Tensors 10.0.14, and for telemetry (MAZ-127) OpenTelemetry.Extensions.Hosting, Exporter.OpenTelemetryProtocol and Exporter.InMemory (tests) 1.20.1, Instrumentation.AspNetCore and Instrumentation.Http 1.20.2, Instrumentation.Runtime 1.20.1 and Npgsql.OpenTelemetry 10.0.3, and for local orchestration (MAZ-138) the Aspire AppHost SDK, Aspire.Hosting.PostgreSQL and Aspire.Hosting.JavaScript 13.6.5. The embedding model is not committed: `node apps/backend/development/download-model.mjs` downloads the pinned files into the ignored `.cache/backend/models/multilingual-e5-small` and verifies their SHA-256 (tests and the HTTP host need it). Tests use the .NET 10 Microsoft.Testing.Platform runner; VSTest command-line flags are not supported. Receipt text (MAZ-125) adds no NuGet package: the API and its tests need Tesseract 5 with English and French data and poppler-utils on the machine (`nix develop` provides them; Debian/Ubuntu: `apt-get install tesseract-ocr tesseract-ocr-eng tesseract-ocr-fra poppler-utils`); a missing engine fails the receipt text tests, nothing is faked.

| Project | Owns |
| --- | --- |
| `src/Penny.Backend.Domain` | Framework-free failures, the v4 ledger document, validation (`LedgerReader`), and household request schemas, join days, settlement and integer-cent splits (`Households`) |
| `src/Penny.Backend.Application` | Use cases (password auth, ledger read/save, household membership, shared expenses and projection), persistence and security ports; no SQL/HTTP references |
| `src/Penny.Backend.Persistence` | EF Core model (`PennyDbContext`) and migrations, repositories, read-only readiness probe and encrypted receipt store |
| `src/Penny.Backend.Api` | Standard CreateBuilder/AddControllers/Build/MapControllers/Run flow, configuration, session authentication, origin/CORS/rate-limit middleware, operational, auth, ledger, household and shared-expense controllers |
| `src/Penny.Backend.AppHost` | Local development only: the Aspire AppHost that orchestrates PostgreSQL, migration, the API, the web app and the Grafana stack (MAZ-138). Never deployed |
| `tests/Penny.Backend.UnitTests` | Configuration bounds/redaction, password hasher, credential/token parity and inward dependency checks |
| `tests/Penny.Backend.IntegrationTests` | One PostgreSQL container and shared WebApplicationFactory, real Kestrel/SQL, per-test data reset, a local HTTPS fake OIDC provider (no external network) |

Production projects live in `src/` and test projects in `tests/`, with matching solution folders. Within projects, responsibilities have their own folders and namespaces:

```text
src/
  Penny.Backend.Api/
    Authentication/  Commands/  Configuration/  Contracts/  Controllers/  Errors/  Households/  Ledgers/  Middleware/  Observability/  Search/
    Program.cs
  Penny.Backend.Application/
    Abstractions/Persistence/  Abstractions/Search/  Abstractions/Security/  Authentication/  Diagnostics/  Households/  Ledgers/  Search/
  Penny.Backend.Domain/
    Errors/  Households/  Ledgers/  Search/
  Penny.Backend.Persistence/
    Configuration/  Health/  Migrations/  Receipts/  Repositories/  Search/
    Schema/  Schema/Entities/  Schema/Mappings/
tests/
  Penny.Backend.IntegrationTests/
    Contracts/  Controllers/  Http/  Migrations/
    Infrastructure/Probes/
  Penny.Backend.UnitTests/
    Architecture/  Authentication/  Configuration/  Households/  Ledgers/  Search/
```

DTOs, enums, fixtures and host helpers each have their own file. Namespace/folder alignment is checked by analyzers; keep new features within their owning project's folders.

Tests use `whenCondition_MethodOrFunctionOrFlow_ShouldExpectedOutcome`, such as `whenDatabaseUnavailable_Readiness_ShouldReturnServiceUnavailable`.

`dotnet.sh` runs from this directory and puts CLI/NuGet/temporary files under the repository's ignored `.cache/backend/`. Commands below run from the repository root. Product storage uses EF Core: entities live in `Schema/Entities/`, one `IEntityTypeConfiguration` per table in `Schema/Mappings/`, and generated migrations in `Migrations/`. Raw SQL is limited to the [documented inventory](../../docs/reference/postgresql.md#raw-sql-inventory). **To change the schema, follow [Changing the schema](../../docs/reference/postgresql.md#changing-the-schema)**: edit the model, run `dotnet ef migrations add`, review the script, test, then `migrate` and re-grant. Respawn 7.0.0 resets product data while preserving EF migration history; migration tests that destroy the schema rebuild it. Maintenance dispatch lives in API `Commands/`. The shared test host pins time through `TestClock` (reset per test), uses secure cookies, and raises the sign-in and invite rate limits; rate-limit, proxy and registration-policy tests start their own hosts on the same database.

## Run the whole stack with Aspire (MAZ-138)

`src/Penny.Backend.AppHost` is a [.NET Aspire](https://aspire.dev) 13.6 AppHost that starts everything for local development with one command: PostgreSQL, the migration step, the search model download, this API, the web app (`apps/web`) and a Grafana stack (Alloy, Loki, Tempo, Prometheus, Grafana). You need the SDK, Node 24 and Docker or Podman; nothing else to set up.

```sh
bash apps/backend/dotnet.sh run --project src/Penny.Backend.AppHost
```

The console prints the Aspire dashboard's login link. The dashboard shows each resource's state, console output and URLs. The first start pulls the images, runs `npm ci` in `apps/web` and downloads the search model; later starts reuse them.

| Resource | What it is | Address |
| --- | --- | --- |
| `postgres` | The pinned pgvector image (`DatabaseSchema.Image`), bootstrapped by `migrate --bootstrap` like Compose. Data lives in the `penny-aspire-postgres` volume | loopback port chosen on the first run |
| `search-model` | `development/download-model.mjs`; exits once the model is verified | — |
| `migrate` | This API's `migrate --bootstrap --grant-runtime` (administrator for the bootstrap, then the migration role); exits when done | — |
| `api` | This API with the runtime role, started after `migrate` and `search-model` finish | `http://localhost:5001` (Scalar at `/scalar/v1`) |
| `web` | `npm run dev` in `apps/web`; Vite forwards `/api/` to `api` | `http://localhost:4173` |
| `alloy` | OTLP receiver; forwards traces to Tempo, logs to Loki and metrics to Prometheus | gRPC on a port chosen on the first run, OTLP/HTTP on `localhost:4318` |
| `loki`, `tempo`, `prometheus` | Single-binary stores with 3-day retention, in `penny-aspire-*` volumes | loopback ports chosen on the first run |
| `grafana` | Data sources provisioned and linked (log → trace, trace → logs and metrics). Anonymous admin, no login | `http://localhost:3000` |

Wiring is done in the AppHost, not by hand: the API gets runtime and migration connection strings for the restricted roles, its receipt and model settings, `OTEL_EXPORTER_OTLP_ENDPOINT` pointing at Alloy and `Auth__AllowedOrigins` with the web origin; the web app gets `PENNY_API_URL`. The API's own [telemetry](../../docs/operations.md#telemetry-opentelemetry) settings apply unchanged; the AppHost only shortens the export intervals so a request shows up within seconds. Telemetry goes to Alloy only: the Aspire dashboard keeps resources and console logs but receives no traces, logs or metrics, so there is one copy, in Grafana. The configs for the Grafana stack are in `development/observability/` (the [reference operator stack](../../docs/observability.md), MAZ-128, runs the same files). Images are pinned by digest in `ObservabilityImages.cs`.

To see a request end to end, use the web app (or `curl http://localhost:4173/api/ready`), then in Grafana open **Explore → Loki**, query `{service_name="penny-backend"}`, expand a line and follow **View trace** to Tempo; the trace links back to its logs and to Prometheus metrics such as `http_server_request_duration_seconds_count`.

Grafana provisions the **Penny** dashboards (API, database, auth and rate limits, background jobs, .NET runtime, clients) and the example alert rules, from the same files the [operator stack](../../docs/observability.md) uses. Client ingest for the web and iOS apps listens on `http://localhost:4319` (OTLP/HTTP) and `http://localhost:12347/collect` (Faro). Grafana reads dashboard files at startup: restart the `grafana` resource after `npm run dashboards:generate`.

Notes:

- **Secrets.** On the first run the AppHost generates the PostgreSQL admin, migration and runtime passwords and the receipt master key and stores them in this project's user secrets (`dotnet user-secrets list --project src/Penny.Backend.AppHost`). The database volume is initialized with them, so do not delete them while the volume exists. If PostgreSQL ever rejects the password (for example after the secrets were cleared, or the very first run was interrupted before they were saved), remove the `penny-aspire-postgres` volume and its container, which loses that local data. Receipts are stored under `.cache/backend/aspire/receipts`, apart from the Compose setup's, because they are encrypted with a different key.
- **Persistent containers.** PostgreSQL, Alloy, Loki, Tempo and Prometheus keep running after the AppHost stops, so restarts are fast; stop them with `docker`/`podman` when you are done. The API, web app and Grafana stop with the AppHost.
- **Podman.** The AppHost selects Podman when there is no Docker CLI or `docker` is Podman's shim. Set `ASPIRE_CONTAINER_RUNTIME` to override.
- **NixOS.** The dashboard needs libicu; the repository's dev shell (`nix develop`, or direnv) provides it on `LD_LIBRARY_PATH`.
- **Ports.** `5001`, `4173`, `3000` and `4318` are fixed, so do not run the Compose-based API below or another Vite server at the same time.
- **Lock file.** The AppHost has no `packages.lock.json`: the Aspire SDK adds orchestrator and dashboard packages for the host OS, so a lock file would only restore on one OS. Its versions are pinned in `Directory.Packages.props` and the project's SDK reference.

## Start a local database and service

```sh
node apps/backend/development/setup.mjs
node apps/backend/development/download-model.mjs
docker compose --env-file apps/backend/.env -f apps/backend/compose.yaml up -d --wait
bash apps/backend/dotnet.sh tool restore
bash apps/backend/dotnet.sh restore Penny.Backend.slnx --locked-mode
bash apps/backend/dotnet.sh run --project src/Penny.Backend.Api -- migrate --bootstrap --grant-runtime
# --grant-runtime applies development/grant-runtime.sql as the schema owner after migrating.
bash apps/backend/dotnet.sh run --project src/Penny.Backend.Api
```

Setup creates `.env` with random, separate admin/reference/runtime passwords, a random receipt master key and a receipt root under `.cache/backend/receipts`, mode 0600, and refuses to overwrite an existing file. An `.env` created before MAZ-52 lacks `Receipts__Root` and `Receipts__MasterKey`; add them by hand (base64 of 32 random bytes for the key). A development volume migrated by an unreleased MAZ-52 SQL draft must be recreated before the EF migration can apply. `dotnet.sh run` loads that local file. Compose binds PostgreSQL to loopback port 5433; the API uses loopback port 5001. Podman users can use a configured Compose provider. PostgreSQL **18.6** comes from the official pgvector image `pgvector/pgvector:0.8.7-pg18-trixie` (pgvector 0.8.7), whose multi-platform digest is pinned identically in Compose and `DatabaseSchema.Image`. PostgreSQL 18 stores the named volume at `/var/lib/postgresql`.

`migrate --bootstrap` (as `ConnectionStrings__Admin`, before migrating; `bootstrap` alone does only this step) runs the embedded `development/bootstrap.sql`: it creates the non-superuser `penny_migrator` and `penny_runtime` roles, the `penny` schema and the extensions when missing, and sets both role passwords from `ConnectionStrings__Migration` and `ConnectionStrings__Postgres` as SCRAM verifiers. Each run sets them again, so `.env` stays authoritative. After migration, apply `development/grant-runtime.sql` as schema owner/admin (`migrate --grant-runtime` runs the same embedded script as the migration role right after migrating): runtime gets DML on every `penny` table and sequence access, read-only migration history, and no schema creation or role/database administration. Re-run it after every migration; it needs no edits for new tables. The migration role owns the `penny` schema and applies EF migrations. Without `--bootstrap`, `migrate` refuses to run while `pg_trgm` or `vector` is missing. Do not remove a volume containing data to change credentials.

Check `http://127.0.0.1:5001/api/health`, `/api/info` and `/api/ready`. In Development only, `/openapi/v1.json` describes implemented controllers and `/scalar/v1` serves the reference UI. The shared `contracts/openapi.json` describes the API the iOS and web apps use. Scalar defaults do not configure a request proxy. Production does not map either documentation route.

## Configuration and operational boundary

ASP.NET configuration/environment variables use double underscores; secrets are not committed. Deployments supply connection strings from their secret manager/environment, not from the development file. Use verified TLS (`SSL Mode=VerifyFull` with the appropriate CA) for remote PostgreSQL; SSL is disabled only in the generated loopback development connection.

| Setting | Default / behavior |
| --- | --- |
| `ConnectionStrings__Postgres` | Required for serving HTTP, restricted runtime credentials |
| `ConnectionStrings__Migration` | Required only for the explicit `migrate` command; runtime startup does not resolve/use it |
| `ConnectionStrings__Admin` | Required only for `migrate --bootstrap` and `bootstrap`: an administrator that can create roles and extensions. `migrate --bootstrap` also reads `ConnectionStrings__Postgres` for the runtime role's password |
| `Receipts__Root` | Absolute directory for encrypted receipt files; required by the receipt commands and, since MAZ-55, by the HTTP host (ledger reads open receipt names; MAZ-60 uploads and downloads). Back it up after the database dump |
| `Receipts__MasterKey` | Base64 32-byte master key; per-file keys are derived from it with HKDF. Never rotated, never logged; back it up in the secret manager |
| `Receipts__MinFreeMegabytes` | 100; bounded 0–1,000,000. `/api/ready` writes and removes one empty probe file in `Receipts__Root` and fails (`receipt-storage`, `disk-space`) when the root is not writable or has less free space (MAZ-63) |
| `Logging__Console__FormatterName` | Unset (simple text). The container image sets `json`; every request logs one access line (method, route template, status, duration) scoped by `RequestId`, the proxy `X-Request-Id` or a generated id echoed in the response ([logs](../../docs/operations.md#logs)) |
| `Database__MaxPoolSize` | 20; bounded 1–100, minimum pool 0 |
| `Database__ConnectTimeoutSeconds` | 5; bounded 1–30 |
| `Database__CommandTimeoutSeconds` | 5; bounded 1–30; cancellation timeout 1 second |
| `Backend__MaxRequestBodyBytes` | 20 MiB; bounded 1–100,000,000; known/chunked bodies enforced by real Kestrel. A declared body up to a quarter of the limit (at least 1 MiB) too large is read and discarded before the 413, within the request deadline, so clients that send the whole body first still receive the error; larger ones are refused unread |
| `Backend__RequestTimeoutSeconds` | 30; bounded 1–300; deadline cancels work and returns 503/Retry-After |
| `Backend__ShutdownTimeoutSeconds` | 30; bounded 1–300; host drains existing requests within this bound |
| `Auth__AllowRegistration` | `true` |
| `Auth__SecureCookies` | `false`. Set `true` behind HTTPS |
| `Auth__AllowedOrigins` | `http://localhost:4173,http://127.0.0.1:4173` (the web dev server). Exact `scheme://host[:port]` origins |
| `Auth__TrustedProxies` | Empty (trust no forwarding headers); comma-separated proxy IPs/CIDRs whose `X-Forwarded-For` is honored |
| `Auth__RateLimitPermits` | 40 per 15-minute window per client shared by register, login, OIDC start/complete and password reset; bounded 1–10,000 |
| `Auth__PasswordResetHours` | 24; lifetime of operator-issued reset codes, bounded 1–168. Read by `reset-password` when it issues a code |
| `Auth__InviteRateLimitPermits` | 20 join attempts per 10-minute window per client on `POST /api/households/join`; bounded 1–10,000 |
| `Oidc__Issuer`, `Oidc__ClientId` | Unset (OIDC off). Setting either enables OIDC and requires both plus `Oidc__RedirectUris`. HTTPS issuer equal to the provider's advertised `issuer` |
| `Oidc__ClientSecret` | Unset (public PKCE client). Secret manager only; sent only to the token endpoint |
| `Oidc__RedirectUris` | Comma-separated exact HTTPS, localhost HTTP or `penny://auth/callback` URIs |
| `Oidc__Label`, `Oidc__AllowRegistration` | `Single sign-on`, `false` (`AllowRegistration` must be `true`/`false`) |
| `Search__ModelDirectory` | Required by the HTTP host and `search-rebuild`: absolute directory with the pinned `model.onnx` and `sentencepiece.bpe.model`. Loaded and SHA-256-verified at startup; the host fails before listening if missing or altered |
| `Search__EmbeddingWorker` | `true`; `false` stops this process from draining the embedding outbox (run it elsewhere) |
| `Search__RateLimitPermits` | 30 searches per minute per session; bounded 1–10,000 |
| `Ocr__Worker` | `true`; `false` stops this process from extracting receipt text (MAZ-125). When on, the host checks `tesseract`, `pdftotext`, `pdftoppm` and every language in `Ocr__Languages` at startup and fails before listening if one is missing |
| `Ocr__Languages`, `Ocr__Tesseract`, `Ocr__PopplerDirectory`, `Ocr__TessdataDirectory` | `eng+fra`, `tesseract` on `PATH`, `PATH`, Tesseract's default. Bounds: `Ocr__Concurrency` 1, `Ocr__TimeoutSeconds` 120, `Ocr__MaxPages` 10, `Ocr__MaxFileMegabytes` 10, `Ocr__MaxAttempts` 4, `Ocr__PollSeconds` 5 ([receipt OCR](../../docs/operations.md#receipt-text-ocr)) |
| `Recurrence__Worker` | `true`; `false` stops this process from recording shared recurring occurrences. Any number of processes may run it (leases keep them apart); at least one must ([topology](../../docs/reference/shared-recurrence.md#deployment-topology)) |
| `Recurrence__PollSeconds` | 60; idle delay between runner passes, bounded 1–3,600 |
| `Push__Worker` | `true`; `false` stops this process from delivering push notifications. Any number of processes may run it (leases keep them apart); at least one must ([push](../../docs/reference/push.md#delivery-outbox-leases-and-retries)) |
| `Push__PollSeconds` | 15; idle delay between delivery passes, bounded 1–3,600 |
| `Push__Apns__TeamId`, `Push__Apns__KeyId`, `Push__Apns__Topic`, `Push__Apns__PrivateKeyPath` or `Push__Apns__PrivateKey` | Unset (APNs off: deliveries wait until configured or expired). All or none; the `.p8` key (path, mode 0600, or PEM from the secret manager) is validated at startup and never logged ([Apple credentials](../../docs/reference/push.md#apple-credentials)) |
| `TestControls__Enabled` | `false`. MAZ-62 full-stack runs only: maps `/api/test/*` (clock, faults, users, reset) and the fault middleware. Startup fails in `Production`, without `TestControls__Token` (32+ characters) or when the `Postgres` database is outside `TestControls__DatabasePrefix` (default and minimum `penny_test`). `TestControls__OidcCertificate` pins the local test OIDC provider's certificate. See [test environment](../../docs/reference/test-environment.md#test-controls) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Unset (telemetry off). Setting it exports traces, metrics and logs over OTLP (MAZ-127). The other standard variables apply: `OTEL_EXPORTER_OTLP_PROTOCOL` (`grpc` or `http/protobuf`), `OTEL_EXPORTER_OTLP_HEADERS` (secret), per-signal `OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_*`, `OTEL_SERVICE_NAME` (default `penny-backend`), `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_TRACES_SAMPLER`/`_ARG`, `OTEL_METRIC_EXPORT_INTERVAL` and `OTEL_SDK_DISABLED`. Invalid values fail startup naming the variable, never its value. Signals, defaults and privacy guarantees: [telemetry](../../docs/operations.md#telemetry-opentelemetry) |
| `ASPNETCORE_URLS`, `ASPNETCORE_ENVIRONMENT` | Standard host settings; development setup sets loopback/Development |

Missing/invalid settings fail before listening, with a setting name and no credentials. An unavailable database allows liveness but fails readiness. Readiness checks PostgreSQL major 18, the `vector` (0.8+) and `pg_trgm` extensions (`search-extensions`), that applied EF migrations exactly match the build and restricted runtime privileges; it issues no DDL. Failures return actionable, sanitized 503 JSON. Deployment must route traffic only after readiness succeeds. This operational probe does not establish product-route or search readiness.

`migrate` exits without starting HTTP. It takes the shared advisory lock, refuses non-18 servers and databases whose history has migrations unknown to this build, and applies pending EF migrations (each in its own transaction; EF also locks the history table). Lock/statement/connection waits are bounded; Ctrl+C cancels the operation. Only one `migrate` runs at a time (advisory lock). The migration role needs CREATE on the database (or ownership of an existing `penny` schema). Runtime credentials cannot execute migrations.

`reset-password EMAIL` also exits without HTTP. It uses the **runtime** connection (`ConnectionStrings__Postgres`), finds the account with the sign-in email rule, replaces any earlier code and prints one single-use code on stdout (guidance and errors go to stderr; exit code 1 for unknown/invalid emails or failures). Deliver the code out of band; the user redeems it with `POST /api/auth/password-reset`, which revokes every session of the account. See the [operator runbook](../../docs/reference/authentication.md#operator-runbook).

```sh
bash apps/backend/dotnet.sh run --project src/Penny.Backend.Api -- reset-password person@example.com
```

`push-smoke-apns DEVICE_TOKEN sandbox|production` (MAZ-61) exits without HTTP or the database: it sends one synthetic alert with the `Push__Apns__*` settings and prints `accepted` (exit 0) or a redacted reason code (exit 2). It is the [physical-device smoke test](../../docs/reference/push.md#physical-device-smoke-test).

`search-rebuild [--user USER_ID]` and `search-verify [--user USER_ID]` (MAZ-121) also exit without HTTP and use the runtime connection plus the receipt settings; rebuild also needs `Search__ModelDirectory`. Rebuild recomputes search documents (after a restore, a normalization change or a model change) and embeds everything owed; verify changes nothing and exits 0 when current, 2 when stale. See [search](../../docs/reference/search.md#operations).

`receipts-ocr [--user USER_ID] [--all]` and `receipts-ocr --status [--user USER_ID]` (MAZ-125) exit without HTTP and use the runtime connection, the receipt and OCR settings and `Search__ModelDirectory`. It queues receipts without text (uploaded before MAZ-125), failed receipts and receipts extracted by another engine or language set (every receipt with `--all`), extracts and embeds them in this process and prints counts. See [receipt OCR](../../docs/operations.md#receipt-text-ocr).

`receipts-verify` and `receipts-sweep [--dry-run]` (MAZ-60) exit without HTTP and use the runtime connection plus the receipt settings. Verify decrypts every receipt file and name and checks its size, exiting 0 when intact and 2 when any file is missing or corrupt; run it after restoring a backup. Sweep removes files no row references once they are an hour old (interrupted uploads). Reports contain counts only. See [receipts](../../docs/reference/receipts.md#backup-and-restore).

Every endpoint and unknown route requires a session unless marked `[AllowAnonymous]`; see the [authentication notes](../../docs/reference/authentication.md) for sessions, cookies, origins, proxies and rate limits. Errors preserve `{error:string}` with 400/401/403/404/409/413/429/500 mapping; timeouts/readiness add 503 and Retry-After. Both error and success responses have no-store/nosniff headers, including timeout responses. Unexpected errors return a generic message; structured logging records exception type/trace ID rather than exception text, credentials, SQL or financial request data. Client disconnect cancellation reaches controller/SQL operations; server deadlines use the original client token when writing the timeout response.

## Upgrading a database from before the squash

Once, for a database last migrated by a build from before the squash, whose `penny."__EFMigrationsHistory"` lists the seven migrations from `20261108152101_InitialSchema` to `20261112020756_AddReceiptTexts`. The seven were replaced by one `20261113183852_InitialSchema`, which no longer has the retired push provider's columns and rows, the one-time import's checkpoint table (`sqlite_import`) or the unused `users.salt` column (password hashes embed their own salt). A new build refuses such a database: `migrate` exits 1 without changes because the history names migrations the build does not know, and `/api/ready` returns 503 (`schema`) because the applied migrations must be exactly the build's. Fresh databases need nothing: `migrate` creates them from `InitialSchema`.

1. Stop every API process (no push worker may run), then back up the database (`pg_dump`, see [operations](../../docs/operations.md)).
2. Run the SQL below once, with `psql --set=ON_ERROR_STOP=1`, as the migration role (`penny_migrator`, which owns the `penny` tables) or an administrator. It runs in one transaction under the `migrate` advisory lock and changes nothing unless the history is exactly the seven old migrations. It deletes the push devices of the retired provider (`provider = 'expo'`) and every delivery planned for or addressed to them (sent or not), drops that provider's receipt columns, lease, index and checks from `push_deliveries`, restricts `push_devices` to APNs on iOS with a required environment and no default provider, drops `sqlite_import` and `users.salt`, and replaces the history with the new migration.
3. Deploy the new build and run `migrate --grant-runtime` as usual. It finds nothing to apply, and the grants no longer name `sqlite_import`. Readiness then returns 200.

Personal ledgers need no check or conversion. They are stored as typed rows (`ledgers` with `ledger_accounts`, `ledger_trips`, `ledger_categories`, `ledger_entries` and `ledger_recurring`), not as JSON documents, and have no version column: every row was validated as a version 4 ledger when it was written, so every stored ledger is version 4. The server now accepts only version 4 writes; a client that sends any other version gets `400 Invalid ledger data.` and nothing is stored. Older app builds that still send version 1–3 ledgers must be updated before they can sync again.

```sql
BEGIN;
DO $$
BEGIN
  -- The lock `migrate` takes, so no migration runs at the same time.
  PERFORM pg_advisory_xact_lock(344760143449);
  IF ARRAY(SELECT "MigrationId"::text FROM penny."__EFMigrationsHistory" ORDER BY 1) <> ARRAY[
    '20261108152101_InitialSchema', '20261108163050_AddOidcAttempts',
    '20261108200954_AddPasswordResets', '20261109015841_AddSearchDocuments',
    '20261109222927_AddApnsPushDelivery', '20261111135519_AddReceiptEncryptionVersion',
    '20261112020756_AddReceiptTexts'] THEN
    RAISE EXCEPTION 'Migration history is not at 20261112020756_AddReceiptTexts; nothing changed.';
  END IF;
END $$;

-- Retired push provider: its deliveries, deliveries to its devices, then the devices.
DELETE FROM penny.push_deliveries
 WHERE provider = 'expo'
    OR token IN (SELECT token FROM penny.push_devices WHERE provider = 'expo');
DELETE FROM penny.push_devices WHERE provider = 'expo';

-- push_deliveries: drop that provider's receipt columns, their lease, index and checks.
DROP INDEX penny.ix_push_deliveries_receipts;
ALTER TABLE penny.push_deliveries
  DROP CONSTRAINT ck_push_deliveries_lease,
  DROP CONSTRAINT ck_push_deliveries_provider,
  DROP COLUMN receipt_checked_at,
  DROP COLUMN lease_owner,
  DROP COLUMN lease_token,
  DROP COLUMN lease_expires_at,
  DROP COLUMN provider;

-- push_devices: APNs on iOS only, no default provider, environment required.
ALTER TABLE penny.push_devices
  DROP CONSTRAINT ck_push_devices_platform,
  DROP CONSTRAINT ck_push_devices_provider,
  ALTER COLUMN provider DROP DEFAULT,
  ALTER COLUMN environment SET NOT NULL,
  ADD CONSTRAINT ck_push_devices_platform CHECK (platform = 'ios'),
  ADD CONSTRAINT ck_push_devices_provider
    CHECK (provider = 'apns' AND environment IN ('sandbox','production'));

-- The one-time import's checkpoint table.
DROP TABLE penny.sqlite_import;

-- users: the unused salt column.
ALTER TABLE penny.users DROP COLUMN salt;

-- One squashed migration replaces the seven.
DELETE FROM penny."__EFMigrationsHistory";
INSERT INTO penny."__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20261113183852_InitialSchema', '10.0.14');
COMMIT;
```

Unsent household notifications keep their outbox rows; one whose only deliveries were to removed devices is planned again for the recipient's APNs devices on the next pass, or expires after 24 hours. The upgraded schema matches a database created by the new `InitialSchema` except for the physical order of a few columns (`push_devices.provider`/`environment`, `receipts.encryption_version`, `search_documents.receipt_id`), which EF Core does not depend on. This was checked on PostgreSQL 18.6 by building a database from the seven old migrations with synthetic users (non-empty salts), ledgers, push devices and deliveries of both providers and an import checkpoint, applying this SQL as `penny_migrator`, and comparing a catalog listing (columns, types, nullability, defaults, collations, constraints, indexes, extensions, history) with a fresh `InitialSchema` database: identical. Running the SQL a second time stopped at the history check. `migrate --grant-runtime` then reported nothing to apply, and a runtime-role API returned 200 from `/api/ready`.

## Verification and CI

```sh
bash apps/backend/dotnet.sh csharpier check .
bash apps/backend/dotnet.sh format analyzers Penny.Backend.slnx --verify-no-changes --no-restore
bash apps/backend/dotnet.sh build Penny.Backend.slnx --configuration Release --no-restore
bash apps/backend/dotnet.sh test --solution Penny.Backend.slnx --configuration Release --no-build --no-restore --report-trx --results-directory ../../test-results/backend
npm run lint
npm run typecheck
```

Tests require the real container runtime; missing Docker/Podman fails the suite rather than skipping or substituting in-memory storage. For rootless Podman, enable its user socket and set `DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock`. Where Ryuk cannot run, set `TESTCONTAINERS_RYUK_DISABLED=true`; the fixture still explicitly disposes its container. Docker CI retains the resource reaper. Test output goes to `test-results/backend/` and containers use ephemeral test databases, never the development database.

`.github/workflows/backend.yml` runs tool/locked restore, formatting, analyzers, Release build and real PostgreSQL tests on PRs and v2 pushes, with test reports on failure. A separate job runs the root npm lint/typecheck.

Troubleshooting: install exactly the SDK in global.json for SDK selection errors; fix/review package locks rather than disabling locked-mode; verify the container socket/image pull for container startup failures; check runtime grants and applied migrations (`penny."__EFMigrationsHistory"`) when readiness returns 503. The wrapper uses the short project-local `.cache/p` for test IPC sockets; very deep Unix checkout paths may require an explicitly shorter `TESTINGPLATFORM_PIPE_DIRECTORY` within the workspace. Do not log connection strings to diagnose failures. Explicitly update tool/package/image pins together and repeat clean-checkout tests.

See [migration architecture](../../docs/reference/architecture.md), [PostgreSQL mapping and recovery](../../docs/reference/postgresql.md), and the repository's [integration-testing skill](../../.agents/skills/dotnet-webapi-integration-testing/SKILL.md).
