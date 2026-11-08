# MAZ-51 verification — 2026-11-07

Branch: `codex/maz-51-postgresql-foundation`, based on `v2` at `c449206`. All work stayed under `/home/mazilious/source/penny`.

The user-supplied `.agents` and `.claude` integration-testing skills were committed first (`49abad1`) and read before implementation. The foundation follows their shared real-PostgreSQL/WebApplicationFactory guidance, retaining the repository's controller startup and legacy error envelope.

| Check | Result |
| --- | --- |
| Pinned tool restore / NuGet `--locked-mode` | Passed in the working tree and a clean archived checkout |
| CSharpier | 41 files checked after the source/test layout revision, passed |
| `dotnet format analyzers ... --verify-no-changes --no-restore` | Passed in both checkouts |
| Release solution build | Passed, 0 warnings and 0 errors |
| Unit/integration suite | 40 passed, 0 failed, 0 skipped; real PostgreSQL 18.6/pg_trgm and real Kestrel |
| `npm run lint` / `npm run typecheck` | Passed |
| Legacy contract tests | 8/8 passed, including the current Node/SQLite journey and exact legacy route coverage |
| Redocly 2.76.0 | Valid OpenAPI 3.1; four style warnings for public GET operations without documented 4xx responses |
| Shell / setup / workflow syntax | Bash syntax, Node syntax and workflow/Compose YAML parsing passed |
| Staged whitespace | Passed |

The initial clean copy lives at `.cache/backend/clean-checkout`, with independent CLI/NuGet/build caches. Its deep Unix path required an explicit `TESTINGPLATFORM_PIPE_DIRECTORY` pointing at the original workspace's `.cache/p`; the wrapper documents and supports this override. Formatting was checked against the full supported file set, not an empty ignored file set. TRX reports remain under the corresponding `test-results/backend/` directories.

The layout revision places production projects under `src/` and test projects under `tests/`, with responsibility-based folders and matching namespaces within every project. DTOs, enums, fixture classes and probe helpers are separate files. Solution folders, project references, CI package-cache paths, agent guidance and run commands were updated. Namespace/folder alignment is enforced by analyzer IDE0130. All 23 test methods (40 cases) use `whenCondition_MethodOrFunctionOrFlow_ShouldExpectedOutcome`, as requested. The unavailable-database test now generates its sentinel password, and Compose uses standard required-variable expressions rather than password-like diagnostic text.

The revised layout was rechecked from a fresh staged-tree archive at `.cache/v51`: independent pinned tool/locked package restores, CSharpier on all 41 files, analyzers, Release build with zero warnings/errors, and all 40 test cases passed. Root lint/typecheck also passed after the naming changes.

Tests cover boot configuration failures; bounded pooling/timeouts and logging redaction; missing/incompatible schema/extension, unavailable database and excessive runtime privileges; read-only startup/readiness; idempotent migration, advisory lock, incompatible-version rejection, non-superuser migration and denied runtime writes; actual CLI success/failure; 400/401/403/404/409/413/500 envelopes; malformed and chunked oversized bodies; client cancellation, server timeout response and graceful request draining; development OpenAPI/Scalar and production documentation gating.

A separate development smoke run generated local ignored credentials, started the pinned PostgreSQL image with the checked-in role initialization script, executed the real `migrate` entry point under the non-superuser migration role, and served health/info/readiness/OpenAPI/Scalar with 200 responses under the runtime role. Ctrl+C shut the API down; the isolated database container was stopped/removed. No production database or user financial data was used. The local development `.env` remains ignored with mode 0600.

Hosted backend and legacy CI are configured in `.github/workflows/backend.yml`; their actual run status belongs to the PR. Local clean-checkout execution does not claim a hosted result. Product schema/SQLite import (MAZ-52), full financial/auth compatibility (MAZ-53–65), search projections/indexes (MAZ-121), deployments and client cutover remain separate gates. This service must not replace the legacy API yet.
