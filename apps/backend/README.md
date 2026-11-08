# Penny ASP.NET Core foundation

MAZ-51 provides a separate controller-based .NET 10 service with PostgreSQL readiness and an explicit foundation migration. The existing Expo/Node/SQLite application continues running unchanged. This service is not ready to replace it: account, ledger, receipt and household routes are owned by MAZ-52–61. Search indexing belongs to MAZ-121.

## Toolchain and layout

Install SDK **10.0.403** (pinned without roll-forward), Node 24 for the legacy checks, and Docker or compatible Podman for PostgreSQL. Packages are centralized in `Directory.Packages.props`, locked per project, and restored only from nuget.org. Current pins: Npgsql 10.0.3, ASP.NET OpenAPI/MVC Testing 10.0.14, Scalar 2.19.0, xUnit v3 4.0.2, Testcontainers 4.16.0 and CSharpier 1.3.0. Tests use the .NET 10 Microsoft.Testing.Platform runner; VSTest command-line flags are not supported.

| Project | Owns |
| --- | --- |
| `src/Penny.Backend.Domain` | Framework-free failures and future domain rules |
| `src/Penny.Backend.Application` | Use cases and persistence ports; no SQL/HTTP references |
| `src/Penny.Backend.Persistence` | Npgsql pooling, read-only compatibility probes and explicit migration runner |
| `src/Penny.Backend.Api` | Standard CreateBuilder/AddControllers/Build/MapControllers/Run flow, configuration, middleware and operational controllers |
| `tests/Penny.Backend.UnitTests` | Configuration bounds/redaction and inward dependency checks |
| `tests/Penny.Backend.IntegrationTests` | One PostgreSQL container and shared WebApplicationFactory, real Kestrel/SQL, per-test compatibility metadata reset |

Production projects live in `src/` and test projects in `tests/`, with matching solution folders. Within projects, responsibilities have their own folders and namespaces:

```text
src/
  Penny.Backend.Api/
    Configuration/  Contracts/  Controllers/  Errors/  Middleware/
    Program.cs
  Penny.Backend.Application/
    Abstractions/Persistence/
  Penny.Backend.Domain/
    Errors/
  Penny.Backend.Persistence/
    Configuration/  Health/  Migrations/  Schema/
tests/
  Penny.Backend.IntegrationTests/
    Contracts/  Controllers/  Http/  Migrations/
    Infrastructure/Probes/
  Penny.Backend.UnitTests/
    Architecture/  Configuration/
```

DTOs, enums, fixtures and host helpers each have their own file. Namespace/folder alignment is checked by analyzers; keep new features within their owning project's folders.

Tests use `whenCondition_MethodOrFunctionOrFlow_ShouldExpectedOutcome`, such as `whenDatabaseUnavailable_Readiness_ShouldReturnServiceUnavailable`.

`dotnet.sh` runs from this directory and puts CLI/NuGet/temporary files under the repository's ignored `.cache/backend/`. Commands below run from the repository root. Product persistence/ORM choice is left to MAZ-52; this foundation uses Npgsql directly rather than adding an unused EF model. With no product tables yet, fixture reset restores compatibility metadata; MAZ-52 should introduce Respawn for product data while retaining migration history. Auth fakes/clock overrides are added only when corresponding features exist.

## Start a local database and service

```sh
node apps/backend/development/setup.mjs
docker compose --env-file apps/backend/.env -f apps/backend/compose.yaml up -d --wait
bash apps/backend/dotnet.sh tool restore
bash apps/backend/dotnet.sh restore Penny.Backend.slnx --locked-mode
bash apps/backend/dotnet.sh run --project src/Penny.Backend.Api -- migrate
bash apps/backend/dotnet.sh run --project src/Penny.Backend.Api
```

Setup creates `.env` with random, separate admin/migration/runtime passwords, mode 0600, and refuses to overwrite an existing file. `dotnet.sh run` loads that local file. Compose binds PostgreSQL to loopback port 5433; the API uses loopback port 5001, leaving the legacy server's 3001 untouched. Podman users can use a configured Compose provider. PostgreSQL **18.6** and the multi-platform image digest are pinned identically in Compose and `DatabaseSchema.Image`. PostgreSQL 18 stores the named volume at `/var/lib/postgresql`; do not reuse a legacy SQLite volume.

The database's first initialization creates non-superuser migration and runtime roles. The migration role can create the `penny` schema and trusted `pg_trgm` extension. Runtime has schema usage and SELECT on compatibility metadata, no schema creation, superuser or role/database administration. Extension installation is explicit and transactional. Initialization scripts run only for a new database volume; updating `.env` does not rotate an existing database's passwords. Do not remove a volume containing data to change credentials; alter roles through an authorized administration session.

Check `http://127.0.0.1:5001/api/health`, `/api/info` and `/api/ready`. In Development only, `/openapi/v1.json` describes implemented controllers and `/scalar/v1` serves the reference UI. The shared `contracts/openapi.json` describes both the legacy compatibility target and marked future/foundation operations. Scalar defaults do not configure a request proxy. Production does not map either documentation route.

## Configuration and operational boundary

ASP.NET configuration/environment variables use double underscores; secrets are not committed. Deployments supply connection strings from their secret manager/environment, not from the development file. Use verified TLS (`SSL Mode=VerifyFull` with the appropriate CA) for remote PostgreSQL; SSL is disabled only in the generated loopback development connection.

| Setting | Default / behavior |
| --- | --- |
| `ConnectionStrings__Postgres` | Required for serving HTTP, restricted runtime credentials |
| `ConnectionStrings__Migration` | Required only for the explicit `migrate` command; runtime startup does not resolve/use it |
| `Database__MaxPoolSize` | 20; bounded 1–100, minimum pool 0 |
| `Database__ConnectTimeoutSeconds` | 5; bounded 1–30 |
| `Database__CommandTimeoutSeconds` | 5; bounded 1–30; cancellation timeout 1 second |
| `Backend__MaxRequestBodyBytes` | 20 MiB; bounded 1–100,000,000; known/chunked bodies enforced by real Kestrel |
| `Backend__RequestTimeoutSeconds` | 30; bounded 1–300; deadline cancels work and returns 503/Retry-After |
| `Backend__ShutdownTimeoutSeconds` | 30; bounded 1–300; host drains existing requests within this bound |
| `ASPNETCORE_URLS`, `ASPNETCORE_ENVIRONMENT` | Standard host settings; development setup sets loopback/Development |

Missing/invalid settings fail before listening, with a setting name and no credentials. An unavailable database allows liveness but fails readiness. Readiness checks PostgreSQL major 18, pg_trgm 1.6, exact schema version 1 and restricted runtime privileges; it issues no DDL. Failures return actionable, sanitized 503 JSON. Deployment must route traffic only after readiness succeeds.

`migrate` exits without starting HTTP. It takes a PostgreSQL transaction-scoped advisory lock, installs foundation metadata/pg_trgm once, refuses incompatible schema/server/extension versions, and rolls back on failure. Lock/statement/connection waits are bounded; Ctrl+C cancels the operation. MAZ-52 extends this runner with versioned product migrations and SQLite import; it must not put migrations into API startup. Managed-host migration roles need CREATE on the database and extension schema for trusted extension provisioning, or an administrator must provision the compatible extension first. Runtime credentials cannot execute the migration.

Errors preserve `{error:string}` with 400/401/403/404/409/413/500 mapping; timeouts/readiness add 503 and Retry-After. Both error and success responses have no-store/nosniff headers, including timeout responses. Unexpected errors return a generic message; structured logging records exception type/trace ID rather than exception text, credentials, SQL or financial request data. Client disconnect cancellation reaches controller/SQL operations; server deadlines use the original client token when writing the timeout response.

## Verification and CI

```sh
bash apps/backend/dotnet.sh csharpier check .
bash apps/backend/dotnet.sh format analyzers Penny.Backend.slnx --verify-no-changes --no-restore
bash apps/backend/dotnet.sh build Penny.Backend.slnx --configuration Release --no-restore
bash apps/backend/dotnet.sh test --solution Penny.Backend.slnx --configuration Release --no-build --no-restore --report-trx --results-directory ../../test-results/backend
npm run lint
npm run typecheck
```

Tests require the real container runtime; missing Docker/Podman fails the suite rather than skipping or substituting SQLite/in-memory storage. For rootless Podman, enable its user socket and set `DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock`. Where Ryuk cannot run, set `TESTCONTAINERS_RYUK_DISABLED=true`; the fixture still explicitly disposes its container. Docker CI retains the resource reaper. Test output goes to `test-results/backend/` and containers use ephemeral test databases, never the development database.

`.github/workflows/backend.yml` runs tool/locked restore, formatting, analyzers, Release build and real PostgreSQL tests on PRs and v2 pushes, with test reports on failure. A separate job retains legacy npm lint/typecheck. Existing legacy application/browser CI also remains active on PRs.

Troubleshooting: install exactly the SDK in global.json for SDK selection errors; fix/review package locks rather than disabling locked-mode; verify the container socket/image pull for container startup failures; check runtime grants, schema version and pg_trgm when readiness returns 503. The wrapper uses the short project-local `.cache/p` for test IPC sockets; very deep Unix checkout paths may require an explicitly shorter `TESTINGPLATFORM_PIPE_DIRECTORY` within the workspace. Do not log connection strings to diagnose failures. Explicitly update tool/package/image pins together and repeat clean-checkout tests.

See [migration architecture](../../docs/migration/architecture.md), [PostgreSQL mapping/cutover](../../docs/migration/postgresql.md), and the repository's [integration-testing skill](../../.agents/skills/dotnet-webapi-integration-testing/SKILL.md). MAZ-51 does not prove product schema/import, legacy-client replacement, financial parity, index performance or production cutover.
