# Penny API compatibility reference

[OpenAPI 3.1](../../contracts/openapi.json) version 1.1.0 describes **40 implemented operations on 31 paths** plus one explicitly planned search v1 operation. It restores the October contract and corrects current `/api/info`, share-payment, lowercase response-envelope, optional move-target, membership and scheduled-projection drift. `x-implementation` distinguishes legacy/planned routes. Existing Node responses and `src/data/households.ts` are the compatibility baseline; only MAZ-121 implements the new search route.

## Transport, identity and errors

- Base path `/api`. Health/info, register/login and OIDC discovery/start/complete precede authentication. Candidate-server verification calls info with credentials omitted and redirects rejected; the current native client accepts `{name:"penny",version:<nonempty string>}`. Web uses its hosting origin.
- Web uses `penny_session`, a 64 lowercase hex token in an HttpOnly, SameSite=Lax `/api` cookie, max age 30 days; Secure follows deployment settings. Native uses `Authorization: Bearer <token>`. A syntactically valid bearer takes precedence over cookies (including expired bearers); malformed bearers fall back to a valid cookie as today. Storage holds SHA-256 token hashes; logout revokes one session and its devices.
- Preserve configured CORS with credentials, Origin checks on non-GET requests, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, 20MB JSON and 10MB decoded receipt limits. Preserve cookie/proxy/OIDC callback paths when deploying a separate web bundle and API.
- JSON errors are `{error:string}`. Branch on status, not English text: 400 invalid/unsafe legacy input, 401 session, 403 origin/permission, 404 absent/private, 409 revision/domain conflict, 413 size, 429 rate limit, generic 500. Cutover maintenance/search timeout uses additive 503 with Retry-After, never acknowledges a save. OIDC attempts remain expiring/single-use and server-side PKCE/nonce/issuer verification is retained.
- Existing clients send no capability/minimum-version signal. No new mandatory header or 426 is introduced. Keep unsafe pre-v3 writes guarded by current 400 behavior; negotiate future breaking changes explicitly before enforcing them.

## Values and revision units

IDs are opaque existing strings, not necessarily UUIDs. Calendar dates are real `YYYY-MM-DD` in 2000-01-01..2100-12-31, months `YYYY-MM`, timestamps integer Unix milliseconds. Money uses integer cents up to 99,999,999,999; shared percentages use integer basis points. Validate real dates/cross-field constraints in services as well as schema patterns. Preserve omitted optional fields versus null. C#/Swift serialization must not convert dates to zones or use floating-point currency.

`GET /ledger` returns `{revision,ledger}`; `PUT` sends the same whole-ledger unit and increments the matching revision once. 409 does not change data. Validate v1–v4 writes and normalize to v4; require v3 accounts/v4 trips and preserve pre-v3 account guards. Enforce entry kinds/category references, personal-share constraints, receipt ownership, household currency and linked-account deletion rules. Clients materialize personal recurrence and merge durable pending changes; the server does not.

Shared expense/rule edits/deletes carry entity revision. Creation begins at zero. Envelopes are lowercase `{household}`, `{expense}`, `{reimbursement}`, `{rule}`. `POST /households/{id}/expenses/{expenseId}/payments` accepts `{fromUserId,revision}` and returns 201 `{expense}` with `payments` and `paymentsClosed`; test stale/duplicate/settled shares. Optional `targetHouseholdId` moves expenses without changing identity under existing restrictions.

`GET /households/projection?month=YYYY-MM` or `year=YYYY` returns `{transactions,scheduled}`. Recorded entries use totalCents/shareCents; month-only previews carry scheduled/recurringId and never count as recorded spending. Shared rows remain separate from private ledger entries. Payer account references are omitted for other viewers; reimbursements record existing payments and never create spending. Former-member history follows server eligibility, not just presence of a cached row.

## Planned extension and drift gates

Search v1 uses authenticated `POST /api/v1/search/transactions`, explicit substring/hybrid modes, date order, authorization before count/page, signed cursor invalidation and explicit local pending/offline scope. [search.md](search.md) defines semantics, language, resource limits and examples. Legacy clients keep working unchanged. PostgreSQL storage is internal; [mapping/cutover](postgresql.md) preserves wire values and revisions.

`tests/core/contracts.test.ts` checks exact implemented route coverage, unique operations/resolved refs, fixture schema subsets, v1–v4 upgrades, real HTTP/temporary SQLite cookie/ledger/409/shared-projection/share-payment behavior, substring fixtures and design trace coverage. UI tests consume the conflict fixture. This lightweight matcher is not a complete JSON Schema engine; Redocly validates the OpenAPI document separately. Service validation and real PostgreSQL cross-stack fixture consumption remain MAZ-52/62/64/121 gates. Do not report future PostgreSQL/Swift/browser behavior as verified by a schema or static storyboard.
