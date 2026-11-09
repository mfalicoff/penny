# Backend API endpoints

[Documentation](README.md) · [Backend architecture](backend-architecture.md)

The current backend exposes **40 method/path combinations** under `/api`. This inventory describes the implemented API as a migration reference for Go or .NET; it does not propose new routes. Paths below include the `/api` prefix. `:id` is a household ID unless the table says otherwise.

Sources: [app composition](../server/app.ts), [HTTP routes](../server/http/), [household implementation](../server/infrastructure/households.ts), and [validation](../server/validation/).

## Common contract

- Requests with a body use JSON with `Content-Type: application/json`, including the DELETE operations that take a body. Receipt uploads also use JSON.
- Only the health, server info, and five public authentication operations are unauthenticated. All other operations require `Authorization: Bearer <token>` or the `penny_session` cookie. A correctly formatted bearer token takes precedence over the cookie.
- Session tokens are opaque 64-character lowercase hex strings. Sessions last 30 days. Registration, login, and OIDC completion return the token and set an HttpOnly, SameSite=Lax cookie scoped to `/api`; Secure is enabled by server configuration.
- Errors use `{ error: string }`: 400 invalid input/JSON, 401 missing/invalid/expired session, 403 forbidden action/origin, 404 missing resource, 409 conflict, 413 oversized JSON, 429 rate limit, and 500 unexpected failure.
- The JSON body limit is 20 MB. API responses set `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. CORS supports configured origins and credentials; non-GET requests with a disallowed Origin are rejected.
- Money uses integer cents, including personal ledger fields named `total` and `share`. Dates use `YYYY-MM-DD`, months `YYYY-MM`, and years `YYYY`. Timestamp fields such as `createdAt` and `expiresAt` use Unix milliseconds.
- Tables show successful status codes. `—` means no request body. Fields with `?` are optional.

## Health and server identity — public (2)

| Method | Path | Purpose | Success |
| --- | --- | --- | --- |
| GET | `/api/health` | Health check | 200 `{ ok: true }` |
| GET | `/api/info` | Identify the backend and its package version | 200 `{ name: "penny", version }` |

## Authentication (7)

| Method | Path | Access | JSON body | Success |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/register` | Public | `{ email, password }` | 201 `{ token, email }` + session cookie |
| POST | `/api/auth/login` | Public | `{ email, password }` | 200 `{ token, email }` + session cookie |
| GET | `/api/auth/oidc` | Public | — | 200 `{ enabled, label? }` |
| POST | `/api/auth/oidc/start` | Public | `{ redirectUri }` | 200 `{ transaction, authorizationUrl, expiresAt }` |
| POST | `/api/auth/oidc/complete` | Public | `{ transaction, callbackUrl }` | 200 `{ token, email }` + session cookie |
| GET | `/api/auth/me` | Session | — | 200 `{ email }` |
| POST | `/api/auth/logout` | Session | — | 200 `{ ok: true }`; clears cookie and revokes this session |

Emails are trimmed and lowercased; passwords must contain 10–256 characters. Registration can be disabled. The four public POST routes share a limit of 40 attempts per IP per 15 minutes.

OIDC start/complete return 404 when SSO is unconfigured. Redirect URIs must match the configured allowlist. Transactions expire after 10 minutes and are consumed once; the backend verifies state, nonce, PKCE, issuer, and identity. OIDC registration has its own configuration and does not automatically link an existing password account by email.

## Personal ledger — session required (2)

| Method | Path | JSON body | Success |
| --- | --- | --- | --- |
| GET | `/api/ledger` | — | 200 `{ revision, ledger }` |
| PUT | `/api/ledger` | `{ revision, ledger }` | 200 `{ revision: previousRevision + 1, ledger }` |

Personal transactions, income, investments, accounts, categories, personal trips, and personal recurring schedules all live inside this snapshot. There are no separate personal CRUD or reporting endpoints.

The current ledger format is version 4:

```json
{
  "version": 4,
  "currency": "CAD",
  "accounts": [],
  "trips": [],
  "categories": [],
  "transactions": [],
  "recurring": []
}
```

The write revision must match the stored revision; stale saves return 409. Revision comparison and increment are atomic. The server accepts ledger versions 1–4 and upgrades older formats, subject to safeguards against losing payment accounts. It validates category/account/trip references, receipt ownership, active-household currency compatibility, and account links from household expenses. Record definitions are in [the ledger model](../src/domain/ledger.ts), and write limits/invariants are in [ledger validation](../server/validation/ledger.ts).

## Receipt files — session required (2)

| Method | Path | JSON body | Success |
| --- | --- | --- | --- |
| POST | `/api/receipts` | `{ name, mime, base64 }` | 201 `{ id, name, mime, uri }` |
| GET | `/api/receipts/:id` | — | 200 raw file bytes with the stored Content-Type |

Here `:id` is a receipt ID, and `uri` is `/api/receipts/<id>`. Supported MIME types are PDF, JPEG, PNG, WebP, GIF, HEIC, and HEIF. The decoded file limit is 10 MB; file signatures are checked. Downloads use inline Content-Disposition and a restrictive Content-Security-Policy. A receipt is readable by its owner or through an authorized household expense; inaccessible receipts return 404. There is no receipt list or delete endpoint. Reverse proxies must accept 20 MB request bodies for uploads. The .NET backend keeps this contract over encrypted file storage; see [receipts](migration/receipts.md) for limits, access, proxy timeouts, backups and client preview behavior.

## Households and shared trips — session required (12)

| Method | Path | Purpose / JSON body | Success |
| --- | --- | --- | --- |
| GET | `/api/households` | List joined, unarchived households, including past memberships | 200 `{ households }` |
| POST | `/api/households` | Create: `{ name, currency, timezoneOffsetMinutes? }` | 201 `{ household }` |
| POST | `/api/households/join` | Join: `{ code, timezoneOffsetMinutes? }` | 200 `{ household }` |
| POST | `/api/households/trips` | Create shared trip: `{ name, currency, startDate, endDate, timezoneOffsetMinutes? }` | 201 `{ household }` |
| GET | `/api/households/projection` | Personal shares across households; optional `?month=YYYY-MM` or `?year=YYYY` | 200 `{ transactions, scheduled }` |
| GET | `/api/households/:id` | Household details and visible membership history | 200 `{ household, members }` |
| PATCH | `/api/households/:id` | Rename: `{ name }` | 200 `{ household }` |
| PATCH | `/api/households/:id/trip` | Edit shared trip: `{ name, startDate, endDate }` | 200 `{ household }` |
| POST | `/api/households/:id/archive` | Archive; no body | 200 `{ ok: true }` |
| POST | `/api/households/:id/invites` | Generate invite; no body | 201 `{ code, expiresAt }` |
| POST | `/api/households/:id/leave` | Leave; no body | 200 `{ ok: true }` |
| DELETE | `/api/households/:id/members/:userId` | Remove member; no body | 200 `{ ok: true }` |

Rename, trip editing, archive, invite creation, and member removal require the household creator. A shared trip is a household with a `trip: { startDate, endDate }` field. Currency must be CAD, USD, EUR, or GBP and match the joining/creating user's ledger. Optional timezone offsets use JavaScript's getTimezoneOffset convention, with a range of -840 to 720 minutes.

Invite codes contain 10 hex characters, expire after 10 minutes, and are replaced when a new code is generated. Joining is limited to 20 attempts per IP per 10 minutes. Leaving/removal requires the member's monthly balances to be settled; archiving requires all monthly balances settled. The creator cannot leave while other active members remain.

Projection returns scheduled previews only for month queries. With neither filter it returns all recorded projections and an empty `scheduled` array; if both filters are supplied, month takes precedence.

## Shared expenses — session required (6)

| Method | Path | Purpose / JSON body | Success |
| --- | --- | --- | --- |
| GET | `/api/households/:id/expenses` | List visible expenses; optional `?month=YYYY-MM` | 200 `{ expenses }` |
| POST | `/api/households/:id/expenses` | Create: `ExpenseInput` | 201 `{ expense }` |
| GET | `/api/households/:id/expenses/:expenseId` | Read one expense | 200 `{ expense }` |
| PUT | `/api/households/:id/expenses/:expenseId` | Replace: `ExpenseInput` + `{ revision, targetHouseholdId? }` | 200 `{ expense }` |
| DELETE | `/api/households/:id/expenses/:expenseId` | Soft-delete: `{ revision }` | 200 `{ ok: true }` |
| POST | `/api/households/:id/expenses/:expenseId/payments` | Record a member's full share: `{ fromUserId, revision }` | 201 `{ expense }` |

`ExpenseInput`:

```ts
{
  title: string;
  totalCents: number;
  date: string;
  payerUserId: string;
  splitMode: "equal" | "exact" | "percent";
  allocations?: (
    { userId: string; amountCents: number } |
    { userId: string; percentBasisPoints: number }
  )[];
  category: { name: string; icon: string; color: string };
  note?: string;
  accountId?: string;
  receiptId?: string;
  timezoneOffsetMinutes?: number;
}
```

Exact splits must sum to the expense total; percentage splits must sum to 10,000 basis points. They must cover every eligible member exactly once. Equal splits are computed by the server. Household eligibility uses membership dates; shared trips use current members and allow expense dates outside travel dates.

Expense responses include calculated `splits`, `payments`, `paymentsClosed`, `revision`, category/note, creator/update metadata, and optional receipt metadata. Only the payer can attach a private account, and only the payer receives `accountId` in reads. Updates, deletes, and payments require the current revision or return 409. `targetHouseholdId` moves an expense into another household with the same currency where the actor is a member.

Only the debtor or expense payer can record a share payment. The server derives the full amount from the split, rejects repeat payments, and closes this option after a monthly reimbursement. Paid expenses cannot be deleted or change payer, total, month, household, or share allocations. Former members retain restricted historical access.

## Monthly settlement and audit — session required (3)

| Method | Path | Purpose / JSON body | Success |
| --- | --- | --- | --- |
| GET | `/api/households/:id/months/:month` | Monthly recap | 200 `{ month, expenses, reimbursements, balances, suggestions, overdue, overdueMonths }` |
| POST | `/api/households/:id/months/:month/reimbursements` | Record settlement: `{ fromUserId, toUserId, amountCents }` | 201 `{ reimbursement }` |
| GET | `/api/households/:id/audit` | Change history; optional `?expenseId=...` | 200 `{ events }` |

Monthly reimbursements can be recorded on the last UTC day of the month or later, by one of the two parties, and must exactly match a current full suggested transfer. They differ from the expense-share payments above. Monthly balances remain independent. Unfiltered audit history is limited to the latest 500 events; expense-filtered history has no explicit limit. Former-member visibility is restricted.

## Shared recurring schedules — session required (4)

| Method | Path | Purpose / JSON body | Success |
| --- | --- | --- | --- |
| GET | `/api/households/:id/recurring` | List schedules | 200 `{ rules }` |
| POST | `/api/households/:id/recurring` | Create: `RecurringInput` | 201 `{ rule }` |
| PUT | `/api/households/:id/recurring/:ruleId` | Replace/pause/resume: `RecurringInput` + `{ revision, active }` | 200 `{ rule }` |
| DELETE | `/api/households/:id/recurring/:ruleId` | Remove: `{ revision }` | 200 `{ ok: true }` |

`RecurringInput` is `ExpenseInput` without `date`, plus `nextDate` and `frequency` (`weekly`, `monthly`, or `yearly`). Updates/deletes require the current revision. Creation starts the rule active at revision 0; updates increment it. Listing includes the anchor day used for calendar recurrence. Any active member can manage schedules; former members receive an empty list.

## Push devices — session required (2)

| Method | Path | JSON body | Success |
| --- | --- | --- | --- |
| POST | `/api/push/devices` | `{ token, platform: "ios" or "android" }`; .NET also accepts native APNs `{ token, platform: "ios", provider: "apns", environment: "sandbox" or "production" }` | 201 `{ ok: true }` |
| DELETE | `/api/push/devices` | `{ token }` | 200 `{ ok: true }` |

These tokens are Expo push tokens (and, in .NET since MAZ-61, native APNs device tokens), distinct from authentication tokens; see [push](migration/push.md). Device registration/removal is associated with the authenticated user/session. There is no public endpoint to send notifications or run the delivery worker.

## Go / .NET migration checklist

- Preserve method/path combinations, JSON field casing, response envelopes, success/error statuses, cookie behavior, and DELETE request bodies to keep existing clients compatible.
- Preserve atomic revision checks, transactional household writes, account/receipt privacy, membership history, cent allocation, and reimbursement rules. Shared household data is stored separately from personal ledger snapshots.
- Keep the full personal snapshot contract during the backend replacement. Separate personal resource endpoints would also require changing the client sync implementation.
- Reproduce the background work in [server startup](../server/index.ts): shared recurring expense creation at startup and every 60 seconds, plus push delivery and delivery-receipt checks at startup and every 15 seconds. These operations have no inbound API routes. Personal recurrence is materialized by the client.
- If retaining the SQLite database and existing logins, preserve its schema/upgrade behavior, salted scrypt password hashes, SHA-256 session/invite token hashes, session expiry, and receipt bytes. OIDC pending transactions currently live in memory and expire after 10 minutes.
- Use [server API tests](../tests/core/server.test.ts), [HTTP boundary tests](../tests/core/server-boundaries.test.ts), [household tests](../tests/core/households-server.test.ts), [OIDC tests](../tests/core/oidc.test.ts), and [push tests](../tests/core/push-server.test.ts) as acceptance cases for the replacement. The current harness constructs the TypeScript app directly and needs adapting to target a Go or .NET server.
