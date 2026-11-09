# Shared contracts

`openapi.json` is OpenAPI 3.1, contract version 1.4.0. Legacy compatibility routes are marked `x-implementation: legacy`; `/api/ready` is `backend-foundation` (MAZ-51), `POST /api/auth/password-reset` is `backend` (implemented only by .NET, MAZ-123), and search v1 `POST /api/v1/search/transactions` is `backend` (.NET only, MAZ-121). The foundation serves health/info/readiness only; the other legacy routes are still supplied by Node pending their port. Preserve v4 ledger/session/ID/revision compatibility regardless of PostgreSQL storage.

- `fixtures/http-journey.json`: sanitized register/ledger/409/shared-projection examples exercised through real legacy HTTP/SQLite.
- `fixtures/ledger-upgrades.json`: validated v1–v4 input and normalized v4 output.
- `fixtures/parity-cases.json`: cents, personal/shared rounding, anchor dates and three-way merge expectations.
- `fixtures/shared-splits.json`: golden equal/exact/percentage split cases (integer cents, remainder allocation, zero shares, rejected totals) consumed by `tests/core/households-domain.test.ts` and the .NET `HouseholdSplitsTests`.
- `fixtures/search-cases.json`: legacy local substring and pending cases (the current app), the shared search normalization (`foldCases`, checked by `tests/core/search-normalization.ts` and the .NET `SearchTextTests`), a server ledger with title/text/typo/filter/sort/pagination cases (`lexicalCases`, `paginationCase`) and English/French/mixed meaning cases (`meaningCases`) run by the .NET real-PostgreSQL `SearchFixtureTests`, plus valid and invalid request examples and a response example. Exotic characters are written as `\u` escapes.
- `fixtures/storage-mapping.json`: exact integer/time/binary/JSON encodings and import blockers for MAZ-52/62; no importer is supplied here.
- `design-baseline.json`: 79 specimen traces, 26 complete control definitions, tokens, source hashes and MAZ-122 handoff limitations. The full design deliverable remains MAZ-122.

Run `npm run test:core`, `npm run test:ui`, `npm run lint` and `npm run typecheck`. Validate the document with `npm exec --yes --package @redocly/cli@2.76.0 -- redocly lint contracts/openapi.json` (also in CI). The lightweight fixture matcher covers this document's exercised subset; it is not a general JSON Schema validator. MAZ-62 must consume fixtures with full schema/model validation in C#, Swift and TypeScript and compare old/new real HTTP behavior.

No production credentials/data belong here. Synthetic addresses use `.test`; ephemeral generated sessions are never fixture credentials. Change OpenAPI, fixtures, drift tests and [compatibility documentation](../docs/migration/api-reference.md) together. See [architecture](../docs/migration/architecture.md), [PostgreSQL recovery](../docs/migration/postgresql.md), [search](../docs/migration/search.md) and [verification](../docs/migration/verification.md).
