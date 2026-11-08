# Shared contracts

`openapi.json` is OpenAPI 3.1, contract version 1.1.0. Implemented `/api` compatibility routes are marked `x-implementation: legacy`; search v1 is explicitly `planned` for MAZ-121. Preserve v4 ledger/session/ID/revision compatibility regardless of PostgreSQL storage.

- `fixtures/http-journey.json`: sanitized register/ledger/409/shared-projection examples exercised through real legacy HTTP/SQLite.
- `fixtures/ledger-upgrades.json`: validated v1–v4 input and normalized v4 output.
- `fixtures/parity-cases.json`: cents, personal/shared rounding, anchor dates and three-way merge expectations.
- `fixtures/search-cases.json`: legacy substring/Unicode/pending cases, planned hybrid cases, request/response schemas and required real-PostgreSQL scenarios. Planned FTS cases are not executed against PostgreSQL here.
- `fixtures/storage-mapping.json`: exact integer/time/binary/JSON encodings and import blockers for MAZ-52/62; no importer is supplied here.
- `design-baseline.json`: 79 specimen traces, 26 complete control definitions, tokens, source hashes and MAZ-122 handoff limitations. The full design deliverable remains MAZ-122.

Run `npm run test:core`, `npm run test:ui`, `npm run lint` and `npm run typecheck`. Validate the document with `npm exec --yes --package @redocly/cli@2.76.0 -- redocly lint contracts/openapi.json` (also in CI). The lightweight fixture matcher covers this document's exercised subset; it is not a general JSON Schema validator. MAZ-62 must consume fixtures with full schema/model validation in C#, Swift and TypeScript and compare old/new real HTTP behavior.

No production credentials/data belong here. Synthetic addresses use `.test`; ephemeral generated sessions are never fixture credentials. Change OpenAPI, fixtures, drift tests and [compatibility documentation](../docs/migration/api-reference.md) together. See [architecture](../docs/migration/architecture.md), [PostgreSQL recovery](../docs/migration/postgresql.md), [search](../docs/migration/search.md) and [verification](../docs/migration/verification.md).
