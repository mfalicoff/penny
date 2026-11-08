# MAZ-51 verification — 2026-11-07

Branch: `codex/maz-51-postgresql-foundation`, based on `v2` at `c449206`. All work stayed under `/home/mazilious/source/penny`.

The user-supplied `.agents` and `.claude` integration-testing skills were committed first (`49abad1`) and read before implementation. The foundation follows their shared real-PostgreSQL/WebApplicationFactory guidance, retaining the repository's controller startup and legacy error envelope.

| Check | Result |
| --- | --- |
| Pinned tool restore / NuGet `--locked-mode` | Passed in the working tree and a clean archived checkout |
| CSharpier | 30 files checked, passed |
| `dotnet format analyzers ... --verify-no-changes --no-restore` | Passed in both checkouts |
| Release solution build | Passed, 0 warnings and 0 errors |
| Unit/integration suite | 40 passed, 0 failed, 0 skipped; real PostgreSQL 18.6/pg_trgm and real Kestrel |
| `npm run lint` / `npm run typecheck` | Passed |
| Legacy contract tests | 8/8 passed, including the current Node/SQLite journey and exact legacy route coverage |
| Redocly 2.76.0 | Valid OpenAPI 3.1; four style warnings for public GET operations without documented 4xx responses |
| Shell / setup / workflow syntax | Bash syntax, Node syntax and workflow/Compose YAML parsing passed |
| Staged whitespace | Passed |

The clean copy lives at `.cache/backend/clean-checkout`, with independent CLI/NuGet/build caches. Its deep Unix path required an explicit `TESTINGPLATFORM_PIPE_DIRECTORY` pointing at the original workspace's `.cache/p`; the wrapper documents and supports this override. Formatting was checked against all 30 supported files, not an empty ignored file set. TRX reports remain under the corresponding `test-results/backend/` directories.

Tests cover boot configuration failures; bounded pooling/timeouts and logging redaction; missing/incompatible schema/extension, unavailable database and excessive runtime privileges; read-only startup/readiness; idempotent migration, advisory lock, incompatible-version rejection, non-superuser migration and denied runtime writes; actual CLI success/failure; 400/401/403/404/409/413/500 envelopes; malformed and chunked oversized bodies; client cancellation, server timeout response and graceful request draining; development OpenAPI/Scalar and production documentation gating.

A separate development smoke run generated local ignored credentials, started the pinned PostgreSQL image with the checked-in role initialization script, executed the real `migrate` entry point under the non-superuser migration role, and served health/info/readiness/OpenAPI/Scalar with 200 responses under the runtime role. Ctrl+C shut the API down; the isolated database container was stopped/removed. No production database or user financial data was used. The local development `.env` remains ignored with mode 0600.

Hosted backend and legacy CI are configured in `.github/workflows/backend.yml`; their actual run status belongs to the PR. Local clean-checkout execution does not claim a hosted result. Product schema/SQLite import (MAZ-52), full financial/auth compatibility (MAZ-53–65), search projections/indexes (MAZ-121), deployments and client cutover remain separate gates. This service must not replace the legacy API yet.
