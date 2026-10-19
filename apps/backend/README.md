# Backend service foundation

This is the future ASP.NET Core API. The current Node service and Expo clients remain the running product. No user, ledger, receipt, or SQLite route is served here yet; those arrive in later migration issues. Do not point existing clients at this service until the compatibility gates pass.

## Prerequisites and layout

- Install the exact .NET SDK in `global.json` (10.0.401). .NET 10 is supported through November 2028. The SDK and ASP.NET shared framework provide all current dependencies; there are no external NuGet packages. Each project's `packages.lock.json` fixes its project dependency graph. `NuGet.Config` has no remote source until the first external package is needed.
- `Penny.Backend.Domain`: domain failures and future pure rules.
- `Penny.Backend.Application`: options, ports, and orchestration.
- `Penny.Backend.Persistence`: data-directory readiness adapter; no SQLite writer yet.
- `Penny.Backend.Api`: HTTP host, dependency injection, configuration, limits, and error mapping.
- `Penny.Backend.Tests`: package-free unit and real HTTP integration harness.

## Local commands

From `apps/backend`:

```sh
dotnet restore Penny.Backend.sln --locked-mode
dotnet format Penny.Backend.sln --verify-no-changes --no-restore
dotnet build Penny.Backend.sln --no-restore
dotnet run --project Penny.Backend.Tests --no-build --no-restore
dotnet run --project Penny.Backend.Api --no-restore --urls http://127.0.0.1:5091
```

`GET /api/health` returns `{"ok":true}` when the process is serving. `GET /api/ready` returns 200 `{"ok":true}` if the configured data directory can be written and 503 `{"ok":false}` otherwise. It checks storage access, not SQLite schema or migration state. Both endpoints are public operational checks. No other product routes exist here yet.

The host creates `Backend:DataDirectory` on startup (`data/backend` relative to the working directory by default). Set `Backend__DataDirectory` for a different volume. `Backend__MaxRequestBodyBytes` defaults to 20 MiB and allows 1–100,000,000 bytes; `Backend__ShutdownTimeoutSeconds` defaults to 30 and allows 1–300 seconds. Invalid values fail startup. ASP.NET Core standard environment configuration and `--Backend:Key=value` command-line overrides work too. The request body cap applies to Kestrel and is checked before route handling when `Content-Length` is known. Readiness takes the request cancellation token; the generic host drains requests for the configured shutdown interval.

Expected application failures map to the legacy JSON `{"error":"..."}` shape (400, 401, 403, 404, 409). Oversized requests use 413; unexpected failures use a generic 500 body and are logged server-side. Status codes are the stable contract, not English message text. The API sends `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. The legacy service remains the only active SQLite writer.

## CI and troubleshooting

`.github/workflows/backend.yml` restores in locked mode, verifies formatting, builds with analyzers and warnings as errors, and runs the unit and HTTP suite in separate build and test jobs. It runs from a clean checkout for `v2` and `main` changes and on manual dispatch. Local `dotnet format` can fix formatting by omitting `--verify-no-changes`.

If SDK selection fails, install exactly 10.0.401; `global.json` disables roll-forward to keep restore reproducible. If locked restore fails after a project reference or package change, run `dotnet restore Penny.Backend.sln` and commit the changed lock file with the source change. If a new external package is required, add a trusted source to `NuGet.Config` and pin the package version in the project. If readiness is 503, check directory existence, mount permissions, and available disk space. If a request returns 413, check `Backend__MaxRequestBodyBytes` and the reverse proxy's own limit. CI does not prove future SQLite migration or client compatibility; those have separate parity gates in `docs/migration/feature-parity.md`.
