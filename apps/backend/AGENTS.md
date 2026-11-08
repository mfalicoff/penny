# Future .NET API

This directory is reserved for MAZ-51 onward. Use ASP.NET Core and PostgreSQL 18 with pinned SDK/provider/patch/image versions. Preserve `contracts/openapi.json`, ledger v4, sessions and legacy clients. Follow `docs/migration/postgresql.md`: SQLite is an import/rollback source, not the v2 runtime. Test real HTTP/PostgreSQL with pg_trgm, atomic revisions/projections, isolation, two-worker leases and import/recovery. Run format/analyzers, build, unit/integration and contract checks. Root Expo guidance applies to the legacy app, not .NET here.
