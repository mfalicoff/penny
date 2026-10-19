# Penny API compatibility reference

The machine-readable baseline is [OpenAPI 3.1](../../contracts/openapi.json). It describes the current Node routes and successful response envelopes. The implementation in `server/http/`, `server/validation/` and `server/infrastructure/households.ts` remains authoritative if a field is unclear. MAZ-51 and MAZ-62 must generate .NET/Swift/web models and drift tests from this contract rather than hand-copying a modified API.

## Transport and errors

- Base path is `/api`. `GET /health` and `/auth/register`, `/auth/login`, `/auth/oidc*` are public. Other paths require a session.
- Browser authentication uses `penny_session`, a 64-hex-token HttpOnly, SameSite=Lax cookie scoped to `/api`, with a 30-day maximum age. `Secure` depends on deployment configuration. Native clients send `Authorization: Bearer <64 lowercase hex chars>`; bearer takes precedence when both are present. Server storage contains only the token hash. Logout revokes one session.
- Browser requests use credentials, configured CORS origins and origin checks on non-GET requests. The API returns `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. JSON bodies are limited to 20 MB. OIDC begin/complete and password auth are rate limited; household join/invites are separately limited.
- Errors are JSON `{"error":"human-readable message"}`. Expected statuses are 400 invalid input, 401 missing/expired session, 403 forbidden/origin denied, 404 absent or private resource, 409 stale revision or domain conflict. Malformed JSON is 400, oversized JSON is 413, unexpected errors are generic 500, and rate limits use 429. Clients must branch on status, not exact English text.
- Dates for ledger and shared expenses are `YYYY-MM-DD` calendar values in 2000-01-01 through 2100-12-31. Months are `YYYY-MM`. Millisecond timestamps are numeric. Money is integer cents (nonnegative or positive as appropriate, maximum 99,999,999,999); percentages for shared expenses are integer basis points.

## Revisions and projections

`GET /ledger` returns `{revision,ledger}`. `PUT /ledger` sends the same envelope and succeeds only if its revision equals the stored revision. The response increments it by one. The entire personal ledger is the write unit; conflicts return 409. Version 1–4 input is validated and upgraded to version 4 on a successful save. The v4 ledger includes `accounts` and `trips`; entries retain `total` and personal `share`, each in cents. Income and investment shares must equal totals. Receipt references must belong to the account. The server blocks currency changes that violate active households and deletion of payment accounts linked from shared expenses.

Shared expense and recurring updates/deletes carry an entity `revision` in their JSON body. Creation starts at revision zero; each edit increments it. Shared expense projection at `GET /households/projection?month=YYYY-MM` (or `year=YYYY`) returns `{transactions:[...]}` with `totalCents` and that viewer's `shareCents`. It is a separate source, not a private ledger entry. Reimbursements are monthly transfers, not spending transactions. Household read models omit a payment `accountId` for every viewer except the payer.

## Version and compatibility examples

Sanitized examples in `contracts/fixtures/` cover registration/ledger/409/shared projection and v1–v4 upgrades. They use `.test` addresses, synthetic IDs and no credentials, receipts or financial data from production. A contract test checks current route coverage, schema references, ledger upgrades and a real temporary SQLite HTTP journey. The future implementation should run the same examples against .NET and add schema-driven response validation. OpenAPI does not by itself prove database migration, exact cookie policies or native offline recovery; those need integration tests.
