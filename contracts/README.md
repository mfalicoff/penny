# Penny compatibility contract

`openapi.json` is the MAZ-50 baseline for all current `/api` routes. It uses [OpenAPI 3.1.0](https://spec.openapis.org/oas/v3.1.0.html) and records the wire shapes that the .NET, Swift and TanStack implementations must preserve during coexistence. The route and schema checks run in `tests/contracts.test.ts` with `npm run test:core`.

`fixtures/ledger-upgrades.json` contains synthetic v1–v4 inputs and expected v4 output. `fixtures/parity-cases.json` covers cents, personal shares, calendar anchors, deterministic shared allocation and field-level conflict merge. `fixtures/http-journey.json` describes a sanitized real HTTP/SQLite journey: registration, cookie attributes, ledger save and 409, two-user shared projection and stale shared edit.

When behavior changes deliberately, update the implementation, this specification, fixtures, API reference and parity matrix together. Keep examples synthetic. A valid OpenAPI file is a contract input, not a substitute for SQLite migration, browser, simulator or physical-device acceptance tests.
