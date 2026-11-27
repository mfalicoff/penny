# Penny API reference

[OpenAPI 3.1](../../contracts/openapi.json) describes every operation the .NET API serves and the iOS and web clients call; paths, envelopes, messages and status codes change only together with every client. The feature documents linked below hold the detailed rules.

## Transport, identity and errors

- Base path `/api`. Health/info, register/login and OIDC discovery/start/complete precede authentication. Candidate-server verification calls info with credentials omitted and redirects rejected; the native client accepts `{name:"penny",version:<nonempty string>}`. Web uses its hosting origin.
- Web uses `penny_session`, a 64 lowercase hex token in an HttpOnly, SameSite=Lax `/api` cookie, max age 30 days; Secure follows deployment settings. Native uses `Authorization: Bearer <token>`. A syntactically valid bearer takes precedence over cookies (including expired bearers); malformed bearers fall back to a valid cookie. Storage holds SHA-256 token hashes; logout revokes one session and its devices.
- Configured CORS with credentials, Origin checks on non-GET requests, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, 20MB JSON and 10MB decoded receipt limits. Keep cookie/proxy/OIDC callback paths when deploying the web bundle and API separately.
- JSON errors are `{error:string, code:string}` ([error codes](#error-codes)). Branch on `code` to tell failures apart, or on status for the class of failure, never on the English text: 400 invalid input, 401 session, 403 origin/permission, 404 absent/private, 409 revision/domain conflict, 413 size, 415 media type (client telemetry only), 429 rate limit, generic 500. Maintenance and search timeouts use 503 with Retry-After and never acknowledge a save. OIDC attempts are expiring and single-use, with server-side PKCE/nonce/issuer verification.
- Clients send no capability/minimum-version signal, and there is no mandatory header or 426. Negotiate future breaking changes explicitly before enforcing them.

## Values and revision units

IDs are opaque strings, not necessarily UUIDs. Calendar dates are real `YYYY-MM-DD` in 2000-01-01..2100-12-31, months `YYYY-MM`, timestamps integer Unix milliseconds. Money uses integer cents up to 99,999,999,999; shared percentages use integer basis points. Real dates and cross-field constraints are validated in services as well as schema patterns. Omitted optional fields and null are distinct. C# and Swift serialization never convert dates to zones or use floating-point currency.

`GET /ledger` returns `{revision,ledger}`; `PUT` sends the same whole-ledger unit and increments the matching revision once. 409 does not change data. Writes must be version 4 with every list (`accounts` and `trips` included). Entry kinds/category references, personal-share constraints, receipt ownership, household currency and linked-account deletion rules are enforced. Clients materialize personal recurrence and merge durable pending changes; the server does not. Details: [ledger sync](ledger.md).

Shared expense/rule edits and deletes carry the entity revision; creation begins at zero. Envelopes are lowercase `{household}`, `{expense}`, `{reimbursement}`, `{rule}`. `POST /households/{id}/expenses/{expenseId}/payments` accepts `{fromUserId,revision}` and returns 201 `{expense}` with `payments` and `paymentsClosed`. Optional `targetHouseholdId` moves expenses without changing identity.

`GET /households/projection?month=YYYY-MM` or `year=YYYY` returns `{transactions,scheduled}`. Recorded entries use totalCents/shareCents and carry `recurringId` when a shared rule recorded them (MAZ-139); month-only previews carry scheduled/recurringId and never count as recorded spending. Shared rows stay separate from private ledger entries. Each row names its payer (`payer`: email, display name when set, `deleted` for a deleted account) and says whether the viewer paid (`paidByYou`, MAZ-275). Payer account references are omitted for other viewers; reimbursements record existing payments and never create spending. Former-member history follows server eligibility.

## Operations by area

- **Readiness (MAZ-51).** Public `GET /api/ready`: 200 `{ok:true}` when the API's database login sees exactly the build's applied EF Core migrations, otherwise sanitized 503 `{error:string}` with Retry-After. Liveness and info do not depend on the database.
- **Accounts and sessions (MAZ-53, MAZ-54, MAZ-170).** `register`, `login`, `me`, `logout` and the OIDC operations `getApiAuthOidc` (the configured providers, `{id, label, icon, native}` each; show a button per entry), `postApiAuthOidcStart` (with `provider`; omitted means the first), `postApiAuthOidcComplete`, the provider callback relay `getApiAuthOidcCallback` and `postApiAuthOidcCallback` (a 303 to the app redirect; not called by the apps) and native sign-in `postApiAuthOidcNativeStart` and `postApiAuthOidcNativeComplete` (Sign in with Apple on iOS). `Profile` adds `providerId` and `providerIcon`. Pending OIDC attempts live in PostgreSQL (10-minute lifetime, single use, 1,000-attempt bound). See [authentication](authentication.md).
- **Profiles (MAZ-171).** `getApiProfile`, `patchApiProfile` (`displayName` string or null, `namePromptDismissed: true`), `putApiProfileAvatar` (the raw picture, PNG, JPEG, WebP, HEIC or HEIF up to 10 MiB, re-encoded on the server as a square WebP of at most 512 px with no metadata, through the sandboxed libvips programs receipts use), `deleteApiProfileAvatar`, `postApiAuthPassword` (a signed-in password change: `{currentPassword, newPassword}`, the sign-up rule, rate-limited like sign-in, other sessions revoked and this one kept, 403 for provider accounts; `Profile.passwordChangedAt` records when) and `getApiUsersUserIdAvatar` (only for the person and for current members of a household or trip they are or were in; anyone else gets 404 `Picture not found.`). Names are display only: trimmed, 1–60 UTF-16 units, no control characters. `register` takes an optional `displayName`; `me` adds `userId`, `displayName`, `avatarUrl` and `needsName`; `HouseholdMember` adds `displayName` and `avatarUrl`. A field the account's OIDC provider sends (`name`, or `given_name` with `family_name`, and `picture`) is read only (403) and refreshed at each sign-in; the picture is copied once per URL (https only, 5 seconds, 10 MiB) so no client loads the provider's URL. A provider that sends nothing for a field leaves it to the person. Schema: `users.display_name`, `name_from_provider`, `avatar_from_provider`, `name_prompt_dismissed`, `avatar_version`, `avatar_source_hash`, `password_changed_at`, and `user_avatars` (deleted with the user).
- **Password reset (MAZ-123).** `POST /api/auth/password-reset` (`postApiAuthPasswordReset`) is public, takes `{token, password}` (a 64-lowercase-hex operator-issued code and a 10–256-unit password, schema `PasswordReset`) and returns `200 {ok:true}` without issuing a session. Errors: one generic `400 This reset code is invalid or has expired.`, `400 Enter a password of 10–256 characters.` (the code stays usable), `400 Invalid JSON.`, `403` origin, `413` and `429` from the shared sign-in limit. The request has no email, so it cannot reveal whether an account exists. Codes come from the operator command `reset-password EMAIL` or, when the server sends email, from the reset link; see [password reset](authentication.md#password-reset-maz-123).
- **Email delivery (MAZ-124).** `GET /api/info` adds `emailEnabled` (absent on older servers: treat as `false`). `POST /api/auth/password-reset/request` (`postApiAuthPasswordResetRequest`) is public, takes `{email}` (schema `PasswordResetRequest`) and always answers `202 {ok:true}` for a well-formed address, account or not; `400 Enter a valid email address.`, `404 This server doesn't send email.` while email is off, `403`, `413` and `429` (shared sign-in limit). Invitations by email are creator-only under `/api/households/{id}/email-invites`: list (`200 {items}`, schema `EmailInviteList`), invite (`202`, `{email}`, schema `EmailInvite`), `{inviteId}/resend` (`202`, `409` after a join) and `DELETE {inviteId}` (`200 {ok:true}`); `429 Too many invitation emails today. Try again tomorrow, or share a code instead.` and `404 This server doesn't send email.` as above. `POST /api/households/join` accepts emailed codes, once. See [email delivery](../self-hosting/email.md), [password reset by email](authentication.md#password-reset-by-email-maz-124) and [invitations by email](households.md#invitations-by-email).
- **Email verification (MAZ-172).** `Profile` adds `emailVerified` (required) and `emailVerifiedAt` (Unix ms, omitted while unverified). `POST /api/auth/email-verification` (`postApiAuthEmailVerification`) is public, takes `{token}` (schema `EmailVerificationRequest`) and answers `200 {email}` (schema `EmailVerified`) or one generic `400 This verification link is invalid or has expired.` `POST /api/auth/email-verification/resend` (`postApiAuthEmailVerificationResend`) is signed in and always answers `202 {ok:true}` (`404` while email is off). `POST /api/auth/email` (`postApiAuthEmail`) changes a password account's email with `{email, password}` (schema `EmailChange`) and answers the updated `Profile`; `400`, `403` for provider accounts, `409 Another account already uses this email.` All three share the sign-in rate limit. Nothing is gated on verification. See [email verification](authentication.md#email-verification-maz-172).
- **Account deletion and export (MAZ-152).** `POST /api/account/delete` (`postApiAccountDelete`, schema `AccountDeletion`) takes `{password}` (`{}` for an account that signs in with a provider), is rate-limited like sign-in and answers `200 {ok:true}`, clearing the session cookie and ending every session; `400 Your password is incorrect.`; `409` when a household rule blocks leaving (settle every month first; a creator only once no other member remains), naming the household. The person leaves every household (`member.left` in the history); their shared expenses, splits, payments and shared schedules stay, without their receipts and account names, so the other members' balances don't move. `HouseholdMember` adds `deleted: true` for such a former member: show "Former member", never the placeholder email. Everything else is deleted in one transaction (ledger, receipts and their text, emailed receipts and the receipt address, search documents, sessions, push devices, pending email and push, the picture, the name and the email), then the files; `users` keeps a tombstone row (`deleted_at`). `GET /api/export` (`getApiExport`) answers one ZIP (`profile.json`, the picture, `ledger.json`, `entries.csv`, `households/*.json`, `receipts/*`) written to a temporary file that is deleted when the download ends. `GET /api/export/entries` (`getApiExportEntries`, `month` YYYY-MM or `year` YYYY, else everything) answers the entries CSV: personal entries and the person's share of recorded shared expenses. Backups keep deleted data until they age out: [backups](../self-hosting/operations.md#back-up).
- **Ledger (MAZ-55).** `getApiLedger` and `putApiLedger` over the typed PostgreSQL ledger. The existing-household check, storable strings and the last safe revision are described in [ledger sync](ledger.md).
- **Households (MAZ-56).** `getApiHouseholds`, `postApiHouseholds`, `postApiHouseholdsTrips`, `getApiHouseholdsId`, `patchApiHouseholdsId`, `patchApiHouseholdsIdTrip`, `postApiHouseholdsIdInvites`, `postApiHouseholdsJoin`, `postApiHouseholdsIdLeave`, `deleteApiHouseholdsIdMembersUserid`, `postApiHouseholdsIdArchive`. Archiving revokes invites (an archived household's code is `400 Invite code is invalid or expired.`). See [households](households.md).
- **Shared expenses (MAZ-57).** `getApiHouseholdsIdExpenses`, `postApiHouseholdsIdExpenses`, `getApiHouseholdsIdExpensesExpenseid`, `putApiHouseholdsIdExpensesExpenseid`, `deleteApiHouseholdsIdExpensesExpenseid`, `postApiHouseholdExpensePayment`, `getApiHouseholdsProjection`: integer-cent equal/exact/percentage splits (`contracts/fixtures/shared-splits.json`), date-based participants, payer-only account ids, per-expense revisions, soft deletes, moves, individual share payments and the read-only projection. See [shared expenses](shared-expenses.md).
- **Settlement (MAZ-58).** `getApiHouseholdsIdMonthsMonth`, `postApiHouseholdsIdMonthsMonthReimbursements`, `getApiHouseholdsIdAudit`: per-month balances and suggested transfers (`contracts/fixtures/settlement.json`), the UTC month-end cutoff, overdue months, household-locked reimbursements and newest-first audit history, whose snapshots never hold the payer's account or receipt filenames. See [settlement](settlement.md).
- **Shared recurrence (MAZ-59).** `getApiHouseholdsIdRecurring`, `postApiHouseholdsIdRecurring`, `putApiHouseholdsIdRecurringRuleid`, `deleteApiHouseholdsIdRecurringRuleid`, plus a PostgreSQL-leased occurrence runner. Create/update return the stored rule including `anchorDay`. See [shared recurrence](shared-recurrence.md).
- **Receipts (MAZ-60, MAZ-131).** `postApiReceipts` and `getApiReceiptsId` over the encrypted file store: the file as the request body with its type in `Content-Type` and name in an RFC 8187 `Content-Disposition` (contract 2.0.0), 32-hex ids and `/api/receipts/<id>` URLs, 10 MiB file/20 MB request limits, signature checks, `inline; filename*=UTF-8''…` and `default-src 'none'; sandbox` download headers, owner-or-household access. See [receipts](receipts.md).
- **Emailed receipts (MAZ-184, in progress).** `getApiReceiptEmail`, `postApiReceiptEmail` (create or rotate), `patchApiReceiptEmail` (`extend`, `allowedSenders`) and `deleteApiReceiptEmail` manage one live private address per user; GET reports `enabled: false` when `InboundMail__Enabled` is off, and the other operations then answer 404. `postApiInboundMail` and `getApiInboundMailRecipients` are for the Cloudflare Email Worker only: no session, an HMAC signature (`webhookSignature`), not routed by the public web proxy. `getApiReceiptInbox` lists the owner-only receipt inbox (newest first, `status=to_attach|attached`, `before` cursor); `deleteApiReceiptInboxId` discards an item and `postApiReceiptInboxIdDone` finishes a partly attached one, both deleting only files nothing links. Attaching uses the normal entry and shared expense saves with the file's `receiptId`; those saves keep the item's status in step. See [emailed receipts](../plans/email-receipts.md).
- **Push devices (MAZ-61).** `postApiPushDevices` and `deleteApiPushDevices` register APNs device tokens (`provider: "apns"`, `environment` `sandbox` or `production`); a PostgreSQL-leased worker delivers. See [push](push.md).
- **Search v1 (MAZ-121).** Authenticated `POST /api/v1/search/transactions` over personal entries and visible shared expenses: accent- and case-insensitive substring, typo-tolerant and meaning-based (on-server embedding) matching, relevance or date/amount sorting, authorization before count/page, keyset cursors and explicit local pending/offline scope. See [search](search.md).
- **Exchange rates (MAZ-151).** Authenticated `GET /api/rates?base=CAD&date=YYYY-MM-DD` (`getApiRates`, schema `ExchangeRates`) answers the cached European Central Bank reference rates for a date in a base currency (`private, max-age=3600`); `400 Invalid exchange rate request.` (`rates.invalid_request`) for an unknown base or an invalid date. `enabled: false` with no rates when the operator turned fetching off. See [exchange rates](exchange-rates.md).

## Participant count

Since contract 2.2.0 a personal expense entry or rule may carry `participants`: how many people split it, the person included, an integer from 2 to 100. The apps set it when you split an expense equally, and Home's Recent says "split N ways" for it (an entry saved before it still reads its count from the total and share when they fit an equal split). It is absent when the entry isn't split or was split by amount or percent, and only expenses may carry it. Materialized occurrences copy it from their rule.

- It is optional, so ledgers written before contract 2.2.0 stay valid and read back unchanged.
- A server before contract 2.2.0 rejects a ledger that carries it (`400 Invalid ledger data.`), so deploy the API before the clients that send it.
- A client before contract 2.2.0 ignores the field when it reads the ledger and drops it when it saves; the entry's `share` is unchanged, only the "split N ways" text is lost.
- Storage: the nullable `participants` column of `ledger_entries` and `ledger_recurring`. The rules and their golden cases (`ledgerParticipants` in `contracts/fixtures/money.json`) are shared by TypeScript, C# and Swift.

## Dismissed suggestions

Since contract 2.3.0 a ledger may carry `dismissedSuggestions`: the recurring suggestions the person dismissed on Recurring, on any device. The apps find suggestions on the device, from the personal ledger (`apps/web/src/domain/suggestions.ts` and `RecurringSuggestions.swift`, kept identical by `contracts/fixtures/recurring-suggestions.json`); the server never analyses the ledger.

- Each item is `{kind}|{key}|{frequency}|{share}`, for example `expense|netflix|monthly|1699`: the suggestion's id and the amount it had when dismissed. A dismissed suggestion comes back when its amount moves by more than 25%.
- At most 500 items, each 1–200 characters, no duplicates, oldest first; the apps keep the newest 500. The server stores the list in order and doesn't read it.
- Offline, the apps merge it as a set union: both sides' dismissals are kept, except one this device undid (golden cases `dismissals:` in `contracts/fixtures/merge-conflicts.json`).
- It is optional, so ledgers written before contract 2.3.0 stay valid and read back unchanged. A server before 2.3.0 rejects a ledger that carries it (`400 Invalid ledger data.`), so deploy the API before the clients that send it. A client before 2.3.0 drops it when it saves, so its dismissed suggestions show again.
- An empty list and no list are stored the same way, so the response leaves the field out when there are none.
- Storage: `ledger_dismissed_suggestions`, one row per item (`value`, keyed with the user, and its `position`), with the length and count limits as check constraints.

## Entries in several currencies

Since contract 2.4.0 (MAZ-151) a personal transaction may carry the amount it was paid in, in any circulating ISO 4217 currency: `originalAmount` (integer minor units of that currency), `originalCurrency`, `rate` (home units per unit, a canonical decimal string), `rateStatus` (`published`, `provisional` or `edited`) and `rateDate` (the publication, absent for an edited rate). `total` and `share` stay home amounts, and `total` must equal `originalAmount × rate` rounded once, half up, to the home currency's minor units. Recurring rules stay in the home currency. Rules: [ledger](ledger.md#entries-in-several-currencies); rates: [exchange rates](exchange-rates.md).

- The fields are optional, so ledgers written before contract 2.4.0 stay valid and read back unchanged.
- A server before contract 2.4.0 rejects a ledger that carries them (`400 Invalid ledger data.`), and has no `GET /api/rates`, so deploy the API before the clients that send them.
- A client before contract 2.4.0 ignores the fields when it reads the ledger and drops them when it saves; the entry keeps its home `total` and `share`, so every total is unchanged, only the original amount and its rate are lost.
- Storage: the nullable `original_amount`, `original_currency`, `rate`, `rate_status` and `rate_date` columns of `ledger_entries`; the reference rates in `exchange_rates`. The rules and their golden cases (`contracts/fixtures/currency.json`) are shared by TypeScript, C# and Swift. Search results and the entries CSV (`Original amount`, `Original currency`, `Exchange rate`) carry them too.

## Error codes

Since contract 2.1.0 (MAZ-187) every error body carries a stable, machine-readable `code` next to the English `error` message, for example `{"error":"Your data changed on another device. Please refresh and try again.","code":"ledger.conflict"}`. The message is unchanged, so clients that read only `error` keep working.

- A code is `area.snake_case` and names one failure. It never changes meaning; a new failure gets a new code rather than reusing one. Codes are only ever added, so a client treats a code it doesn't know like its status.
- Failures that share one message can have different codes. Receipt uploads, for example, answer `receipt.unsupported_type` or `receipt.invalid_name` with the same "Choose a photo or PDF smaller than 10 MB." message, and `receipt.too_large` or `receipt.unsupported_file` with "This file is not a supported photo or PDF, or exceeds 10 MB.".
- A server before contract 2.1.0 sends `error` only.
- `ErrorCodes` (`apps/backend/src/Penny.Backend.Domain/Errors/ErrorCodes.cs`) is the catalogue. The `Error` schema in `contracts/openapi.json` lists every value, and the .NET `DocumentationTests` and the web `tests/api-errors.test.ts` (against `src/api/errorCodes.ts`) fail when the three disagree. The integration tests check that every error they assert carries a catalogued code.
- A body that isn't `application/json` still counts as no body on the JSON endpoints, so validation answers it (for example `400 Invalid ledger data.`, `ledger.invalid`). It does not become `415`; see [legacy compatibility](legacy-compatibility.md#decisions).

Messages ending in "…" are shortened here; `<household>` is the household's name.

| Code | Status | Message |
| --- | --- | --- |
| `account.creator_with_members` | 409 | You created <household>, and other people are still in it. … |
| `account.unsettled` | 409 | Settle every monthly balance in <household> before you delete your account. |
| `account.wrong_password` | 400 | Your password is incorrect. |
| `auth.duplicate_email` | 409 | An account with this email already exists. Please sign in. |
| `auth.email_in_use` | 409 | Another account already uses this email. |
| `auth.email_managed` | 403 | Your sign-in provider manages your email. Change it with your provider. |
| `auth.invalid_credentials` | 401 | Email or password is incorrect. |
| `auth.invalid_new_password` | 400 | Use a new password of 10–256 characters. |
| `auth.invalid_registration` | 400 | Enter a valid email and a password of 10–256 characters. |
| `auth.no_password` | 403 | Your account signs in with your sign-in provider, so it has no password to change. |
| `auth.oidc_account_exists` | 409 | This account already exists. Please try signing in again. |
| `auth.oidc_email_in_use` | 409 | An account already uses this email. Sign in with its existing method; automatic account linking is disabled. |
| `auth.oidc_registration_disabled` | 403 | New single sign-on accounts are disabled on this server. |
| `auth.registration_disabled` | 403 | Account registration is disabled on this server. |
| `auth.sign_in_required` | 401 | Please sign in to continue. |
| `auth.wrong_current_password` | 400 | Your current password is incorrect. |
| `email_verification.invalid_token` | 400 | This verification link is invalid or has expired. |
| `email_verification.unknown_email` | 404 | No account uses this email. Emails match exactly after trimming and lowercasing. |
| `expense.account_not_found` | 400 | Payment account not found. |
| `expense.already_paid` | 409 | This share is already paid. |
| `expense.changed` | 409 | Expense changed. Refresh and try again. |
| `expense.destination_currency` | 400 | The destination must use the same currency. |
| `expense.invalid_year` | 400 | Invalid year. |
| `expense.not_found` | 404 | Expense not found. |
| `expense.paid_delete` | 409 | Paid expenses cannot be deleted. |
| `expense.paid_locked` | 409 | Paid expenses cannot change payer, total, month or household. |
| `expense.paid_shares` | 409 | Paid expenses cannot change share allocations. |
| `expense.payer_not_member` | 400 | The payer must be a current household member. |
| `expense.payer_only_account` | 403 | Only the payer can attach a payment account. |
| `expense.payer_own_share` | 400 | The payer cannot pay their own share. |
| `expense.payment_forbidden` | 403 | Only the debtor or expense payer can record this payment. |
| `expense.payments_closed` | 409 | This month already has monthly reimbursements. Settle the remaining monthly balance instead. |
| `expense.positive_share` | 400 | Choose a member with a positive share. |
| `expense.receipt_unavailable` | 400 | Receipt is not available to this household. |
| `health.database_unavailable` | 503 | Database is unavailable. … |
| `health.disk_space` | 503 | Receipt storage is low on free disk space. … |
| `health.permissions` | 503 | Database user cannot read compatibility metadata. … |
| `health.postgres_version` | 503 | The backend requires PostgreSQL 18. |
| `health.receipt_storage` | 503 | Receipt storage is not writable. … |
| `health.schema` | 503 | Database schema is missing or incompatible. … |
| `health.search_extensions` | 503 | Database is missing the pg_trgm or vector extension. … |
| `household.already_member` | 409 | You are already a member. |
| `household.creator_cannot_be_removed` | 400 | The creator cannot remove themselves. |
| `household.creator_cannot_leave` | 409 | The creator cannot leave while other members remain. |
| `household.creator_only` | 403 | Only the household creator can manage members. |
| `household.currency` | 400 | Household currency must match your ledger currency. |
| `household.invalid_data` | 400 | Invalid household data. |
| `household.invalid_invite` | 400 | Invite code is invalid or expired. |
| `household.not_found` | 404 | Household not found. |
| `household.trip_currency` | 400 | Trip currency must match your ledger currency. |
| `household.trip_not_found` | 404 | Trip not found. |
| `household.unsettled_archive` | 409 | Settle all monthly balances before archiving. |
| `household.unsettled_exit` | 409 | Settle every monthly balance before leaving. |
| `inbound_mail.bad_signature` | 401 | The request signature is missing or invalid. |
| `inbound_mail.empty` | 400 | The message is empty. |
| `inbound_mail.rate_limited` | 429 | Too many messages for this address. Try again later. |
| `inbound_mail.too_large` | 413 | The message is too large. |
| `inbound_mail.unknown_address` | 404 | Unknown address. |
| `invite.invalid_email` | 400 | Enter a valid email address. |
| `invite.joined` | 409 | They already joined with this invitation. |
| `invite.not_found` | 404 | Invitation not found. |
| `invite.too_many` | 429 | Too many invitation emails today. Try again tomorrow, or share a code instead. |
| `ledger.conflict` | 409 | Your data changed on another device. Please refresh and try again. |
| `ledger.currency_mismatch` | 400 | Your ledger currency must match your active households. |
| `ledger.foreign_receipt` | 400 | Receipt does not belong to this account. |
| `ledger.invalid` | 400 | Invalid ledger data. |
| `ledger.linked_account` | 400 | Remove household expense links before deleting this payment account. |
| `mail.disabled` | 404 | This server doesn't send email. |
| `oidc.expired` | 401 | Sign-in expired. Please try again. |
| `oidc.invalid_response` | 400 | Invalid sign-in response. |
| `oidc.native_not_configured` | 400 | This sign-in provider can't be used from the app's own sign-in. |
| `oidc.not_configured` | 404 | Single sign-on is not configured. |
| `oidc.not_verified` | 401 | Sign-in could not be verified. Please try again and allow access to your verified email. |
| `oidc.provider_not_configured` | 404, 400 | This sign-in provider is not configured on the server. |
| `oidc.provider_unavailable` | 400 | The sign-in provider is unavailable. Please try again. |
| `oidc.redirect_not_configured` | 400 | This sign-in redirect is not configured on the server. |
| `oidc.too_many_attempts` | 403 | Too many sign-in attempts. Try again later. |
| `origin.forbidden` | 403 | This origin is not allowed. |
| `password_reset.invalid_email` | 400 | Enter a valid email address. |
| `password_reset.invalid_password` | 400 | Enter a password of 10–256 characters. |
| `password_reset.invalid_token` | 400 | This reset code is invalid or has expired. |
| `password_reset.unknown_email` | 404 | No account uses this email. Emails match exactly after trimming and lowercasing. |
| `profile.avatar_managed` | 403 | Your sign-in provider manages your picture. Change it with your provider. |
| `profile.invalid_body` | 400 | Send displayName as a string or null, and namePromptDismissed as true. |
| `profile.invalid_name` | 400 | Enter a name of 1 to 60 characters, without line breaks or control characters. |
| `profile.invalid_picture` | 400 | Choose a PNG, JPEG, HEIC or WebP picture up to 10 MB. |
| `profile.name_managed` | 403 | Your sign-in provider manages your name. Change it with your provider. |
| `profile.picture_not_found` | 404 | Picture not found. |
| `profile.unreadable_picture` | 400 | Penny couldn't read this picture. Choose another one. |
| `push.invalid_device` | 400 | Invalid push device. |
| `rate_limit.auth` | 429 | Too many attempts. Please try again in 15 minutes. |
| `rate_limit.inbound_mail` | 429 | Too many recipient list requests. Try again later. |
| `rate_limit.invite` | 429 | Too many invite attempts. Try again later. |
| `rate_limit.search` | 429 | Too many searches. Try again in a minute. |
| `rate_limit.telemetry` | 429 | Too many telemetry reports. Try again later. |
| `receipt.changed` | 409 | A receipt changed while you were saving. Reload and try again. |
| `receipt.invalid_name` | 400 | Choose a photo or PDF smaller than 10 MB. |
| `receipt.not_found` | 404 | Receipt not found. |
| `receipt.outdated_client` | 400 | Update Penny to upload receipts. |
| `receipt.too_large` | 400 | This file is not a supported photo or PDF, or exceeds 10 MB. |
| `receipt.unsupported_file` | 400 | This file is not a supported photo or PDF, or exceeds 10 MB. |
| `receipt.unsupported_type` | 400 | Choose a photo or PDF smaller than 10 MB. |
| `receipt_email.invalid_senders` | 400 | Allowed senders must be email addresses or domains, at most 50 of them. |
| `receipt_email.invalid_update` | 400 | Send extend: true, allowedSenders, or both to change the receipt address. |
| `receipt_email.no_address` | 404 | There is no receipt address. Create one first. |
| `receipt_email.not_enabled` | 404 | Receipt email is not enabled on this server. |
| `receipt_email.too_many_addresses` | 429 | Too many new receipt addresses today. Try again tomorrow. |
| `receipt_inbox.invalid_filter` | 400 | status must be to_attach or attached. |
| `receipt_inbox.not_found` | 404 | Inbox item not found. |
| `recurring.payer_not_current` | 400 | Payer must be a current member. |
| `recurring.rule_changed` | 409 | Recurring rule changed. Refresh and try again. |
| `recurring.rule_not_found` | 404 | Recurring rule not found. |
| `request.failed` | 4xx | The request could not be completed. |
| `request.invalid` | 400 | Invalid request. |
| `request.invalid_json` | 400 | Invalid JSON. |
| `request.timed_out` | 503 | The request timed out. Please retry. |
| `request.too_large` | 413 | The upload is too large. |
| `route.not_found` | 404 | API route not found. |
| `search.invalid_cursor` | 400 | Invalid search cursor. |
| `search.invalid_request` | 400 | Invalid search request. |
| `search.timed_out` | 503 | Search took too long. Please retry. |
| `server.busy` | 503 | The server was busy. Please retry. |
| `server.error` | 500 | The server could not complete this request. |
| `settlement.month_not_found` | 404 | Month not found. |
| `settlement.month_open` | 409 | Record reimbursements on the last day of the month or later. |
| `settlement.not_involved` | 403 | Only people involved can record a reimbursement. |
| `settlement.not_suggested` | 409 | This is no longer the full suggested reimbursement. |
| `settlement.same_member` | 400 | Choose two different members. |
| `split.distinct_members` | 400 | Select distinct members. |
| `split.every_member` | 400 | Provide one split for every eligible member. |
| `split.exact_amounts` | 400 | Exact splits need amounts. |
| `split.percent_amounts` | 400 | Percentage splits need percentages. |
| `split.total_mismatch` | 400 | Split shares must add up to the expense total. |
| `telemetry.invalid` | 400 | The telemetry report is not valid. |
| `telemetry.media_type` | 415 | Send telemetry as uncompressed application/json. |
| `telemetry.off` | 404 | Client telemetry is off on this server. |
| `telemetry.too_large` | 413 | The telemetry report is too large. |

## Drift gates

`apps/web/tests/domain/contracts.test.ts` checks unique operations and resolved refs, fixture schema subsets (including the sanitized `http-journey.json`, which the .NET `LedgerTests` replay over HTTP), substring fixtures and design trace coverage. Its matcher is not a complete JSON Schema engine; Redocly validates the OpenAPI document separately (CI). The .NET integration suites exercise every operation on real PostgreSQL.
