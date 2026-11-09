# Household and shared-trip membership (MAZ-56)

The .NET backend serves the household and shared-trip **membership, invitation, trip and archive** operations of the legacy server (`server/infrastructure/households.ts`, `server/http/households.ts`) with the same paths, envelopes (`src/data/households.ts`), status codes, messages and check order, except for the [deliberate differences](#deliberate-differences-from-the-legacy-service) below. Node still serves production, so `contracts/openapi.json` keeps `x-implementation: legacy` for these operations.

Code: `Domain/Households` (request schemas, local join day, settlement rule), `Application/Households/HouseholdService` (rules, check order, audit), `Persistence/Repositories/PostgresHouseholdRepository` and `PostgresHouseholdTransaction` (transactions and row locks), `Api/Controllers/HouseholdsController`, `Api/Households/InviteRateLimit`. Tests: `UnitTests/Households` and the real-PostgreSQL `IntegrationTests/Controllers/Household*Tests`, `Http/HouseholdPolicyTests` and `Migrations/ImportedHouseholdTests`.

Shared expenses, splits, individual payments and the personal projection are served by MAZ-57 ([shared expenses](shared-expenses.md)). Monthly recap, reimbursements and the audit endpoint (MAZ-58), shared recurrence (MAZ-59), push (MAZ-61), search (MAZ-121) and email invitations (MAZ-124) are not part of this port; their .NET routes return `404 API route not found.`

## Endpoints

All operations require a session (cookie or bearer). Unknown households, households the caller never joined and, for writes, archived households all answer `404 Household not found.`, so they cannot be told apart.

| Operation | Route | Success | Who |
| --- | --- | --- | --- |
| `getApiHouseholds` | `GET /api/households` | `200 {households}` | Households the caller has **ever** joined (current or former member), not archived, newest first |
| `postApiHouseholds` | `POST /api/households` | `201 {household}` | Anyone; the caller becomes creator and first member |
| `postApiHouseholdsTrips` | `POST /api/households/trips` | `201 {household}` with `trip` | Same, for a shared trip |
| `getApiHouseholdsId` | `GET /api/households/{id}` | `200 {household, members}` | Current and former members, also after archiving |
| `patchApiHouseholdsId` | `PATCH /api/households/{id}` | `200 {household}` | Creator |
| `patchApiHouseholdsIdTrip` | `PATCH /api/households/{id}/trip` | `200 {household}` | Creator, shared trips only |
| `postApiHouseholdsIdInvites` | `POST /api/households/{id}/invites` | `201 {code, expiresAt}` | Creator |
| `postApiHouseholdsJoin` | `POST /api/households/join` | `200 {household}` | Anyone with a live code (rate limited) |
| `postApiHouseholdsIdLeave` | `POST /api/households/{id}/leave` | `200 {ok:true}` | Current members |
| `deleteApiHouseholdsIdMembersUserid` | `DELETE /api/households/{id}/members/{userId}` | `200 {ok:true}` | Creator |
| `postApiHouseholdsIdArchive` | `POST /api/households/{id}/archive` | `200 {ok:true}` | Creator |

`household` is `{id, name, currency, creatorId, createdAt, memberCount, trip?}`: `createdAt` is Unix milliseconds, `memberCount` counts current members, and `trip: {startDate, endDate}` appears only for shared trips. Members are `{userId, email, joinedAt, joinedOn?, leftAt?}`, one per account, from the account's **latest** membership period, ordered by `joinedAt` then `userId`. A former member sees only the members who had joined by the time they left.

## Validation and errors

Errors use `{error: string}`. Request bodies follow the legacy zod schemas: unknown keys are ignored, optional fields may be absent but never `null`, numbers must be JavaScript safe integers (`240.0` is 240), names are trimmed with JavaScript whitespace rules and then must be 1–80 UTF-16 units, currencies are `CAD`/`USD`/`EUR`/`GBP`, `timezoneOffsetMinutes` is −840..720, dates are real `YYYY-MM-DD` days from 2000-01-01 to 2100-12-31 and a trip's end is not before its start. Any schema failure is `400 Invalid household data.`; malformed JSON is `400 Invalid JSON.`.

| Operation | Checks in order |
| --- | --- |
| Create / create trip | body (`400 Invalid household data.`) → creator's ledger currency equals `currency` (`400 Household currency must match your ledger currency.` / `400 Trip currency must match your ledger currency.`) |
| Rename / update trip | current member of an unarchived household (`404 Household not found.`) → creator (`403 Only the household creator can manage members.`) → body (`400`) → trip update on a regular household (`404 Trip not found.`) |
| Invite / archive | member (`404`) → creator (`403`) → archive only: every month settled (`409 Settle all monthly balances before archiving.`) |
| Join | body: `code` is 10 hex characters, any case (`400 Invalid household data.`) → code exists and is unexpired (not replaced), household not archived (`400 Invite code is invalid or expired.`) → joiner's ledger currency equals the household's (`400 Household currency must match your ledger currency.`) → not already a current member (`409 You are already a member.`) |
| Leave | current member (`404`) → creator with other current members (`409 The creator cannot leave while other members remain.`) → caller settled in every month (`409 Settle every monthly balance before leaving.`) |
| Remove | caller is a current member (`404`) → caller is creator (`403`) → target is not the creator (`400 The creator cannot remove themselves.`) → target is a current member (`404`) → target settled (`409 Settle every monthly balance before leaving.`) |

`POST /api/households/join` has its own fixed 10-minute window of 20 attempts per client (the same client key as the sign-in limit; IPv6 grouped by /56): `429 Too many invite attempts. Try again later.` with `Retry-After`. `Auth__InviteRateLimitPermits` (default 20, 1–10,000) sets the budget. As with sign-in, the draft-8 `RateLimit` headers are not sent and counters are per process.

## Membership rules

- **Membership periods.** Membership is stored only as `household_member_periods`. Creating a household opens the creator's period; each join opens a new period, so a former member who rejoins keeps the earlier periods. Leaving or removal closes the open period at the current instant (never before it began, even if instance clocks differ). At most one period per member is open (partial unique index).
- **Local join day.** Clients send `Date#getTimezoneOffset()` minutes on create and join. The server records `joinedOn`, the member's local calendar day at that instant, so a member who joins at 9:30 p.m. in Toronto (already the next day in UTC) can share expenses dated that local day. Without an offset (older clients) `joinedOn` is absent and date-based expense rules ([MAZ-57](shared-expenses.md#eligible-members-historical-participant-sets)) derive the day from the join instant shifted by the expense request's offset, as before. Join days are not clamped to a trip's travel range.
- **Historical expenses.** Joining never changes existing expenses, splits or payments. A member who joins after historical expenses owes nothing for them and may leave immediately.
- **Creator restrictions.** Only the creator renames, edits trip dates, invites, removes members and archives. The creator cannot remove themselves and cannot leave while other members remain; once alone, the creator may leave, which leaves the household with no members (it is kept, as before).
- **Settlement.** A member may leave, or be removed, only when their balance is zero in **every** month; months are independent, so a credit in one month never offsets a debt in another. Archiving requires every member to be settled in every month. A month's balance is computed exactly as the legacy recap: the payer is credited each live (not deleted) expense total, each split debits its member, and every reimbursement in that month (monthly reimbursements and individual expense payments alike) credits the sender and debits the recipient. MAZ-56 reads these rows; MAZ-57 writes expenses, splits and individual payments, MAZ-58 monthly reimbursements.
- **Former members** keep their history: the household stays in their list until archived, and they can still read its detail and the expenses they have a share in ([MAZ-57](shared-expenses.md)). They can no longer act on it (`404`).
- **Archive** hides the household from every list, refuses every membership change (`404`), revokes outstanding invites and stops constraining members' ledger currency (ledger check 5 counts only unarchived households). Members can still read the archived household's detail.

## Invitations

- A code is 5 random bytes from the BCL `RandomNumberGenerator`, written as 10 upper-case hex characters. Only `SHA-256(code)` (lower-case hex, the legacy `hashToken`) is stored in `household_invites.code_hash`, so stored hashes cannot be replayed and imported invites keep working. Codes are accepted in any case.
- A code expires 10 minutes after it is issued (`expiresAt` is Unix milliseconds; valid while `expiresAt > now`).
- A household has one live code: issuing a new code deletes the previous ones.
- **A code admits any number of accounts** until it expires or is replaced, as in legacy, so one code can be shared with a group. Joining never consumes or marks it (`household_invites.used_at` stays empty). Each account still joins only once: a current member gets `409 You are already a member.`

## Shared trips and personal trip links

A shared trip is a household with a travel range (`households.trip_start/trip_end`). Its membership is the same period-based membership as any household; the travel range never gates membership (members may join before, during or after it) and changing the range never moves expenses or memberships, because bookings are often dated outside it.

A **personal** ledger trip may point to a shared trip with `sharedHouseholdId` (ledger v2). That link is private ledger data, written only through `PUT /api/ledger`: joining, leaving, removal or archiving never add, change or clear it, and it does not make anyone a member. The ledger only checks that the household exists.

## Transactions, locking and concurrency

Every mutation runs in one READ COMMITTED transaction in `PostgresHouseholdRepository.WriteAsync`; a failure, cancellation or timeout rolls back everything, including the audit row. Reads (`list`, `detail`) use one REPEATABLE READ snapshot.

- **Household lock first.** Every membership writer (rename, trip, invite, join, leave, remove, archive) first locks the household row, then re-checks membership and creator rights inside the lock. Writers of one household therefore serialize; settlement checks see the committed state the change is based on. Shared-expense writers take the same lock before changing expenses, splits or payments (MAZ-57, see [shared expenses](shared-expenses.md#transactions-locking-and-concurrency); MAZ-58 reimbursements must too), so the settlement check stays race-free.
- **Ledger lock second.** Create and join lock the member's `ledgers` row (the row `PUT /api/ledger` compare-and-increments) before comparing currencies, so a concurrent ledger save that changes currency either commits first (the join then fails) or waits and then fails ledger check 5. A member can never end up in a household with a different currency.
- **Invite re-check under the lock.** The join reads the invite to find its household, locks the household, then reads the invite again. Issuing a new code and archiving hold the same household lock while they delete invites, so a code replaced or revoked by a concurrent request is rejected (`400 Invite code is invalid or expired.`) and never admits anyone after its replacement commits. Joins of one household serialize on the household lock, so concurrent joins of different accounts with one code each succeed exactly once, and the same account racing itself opens one period (the loser gets `409 You are already a member.`; the partial unique index on open periods is the backstop).
- Locks are taken with EF `ExecuteUpdate` statements that rewrite a column with its own value; PostgreSQL holds the row lock until commit. This keeps the [raw SQL inventory](postgresql.md#raw-sql-inventory) unchanged, and the lock does not block foreign-key checks of rows that merely reference the household. The order (household, then the user's ledger, then invites and periods) matches the [documented lock order](postgresql.md#concurrency-and-transactions), and ledger saves never lock households, so these writers cannot deadlock with each other or with ledger saves. No request is retried by the server.

Verified with real PostgreSQL: eight accounts using one code at once (each joins exactly once), one account joining twice at once (one open period), join against archive, leave against removal, leave against archive, join against a ledger currency change, and join against invite replacement.

**Search (MAZ-121).** No search projection exists yet. `HouseholdService` marks the seams in join, leave/removal and archive: when MAZ-121 adds membership-derived search visibility it must update it inside these transactions, before commit, so search access changes exactly when membership does.

## Audit

Membership operations write the legacy audit rows in the same transaction: `household.created`, `trip.created` (after: household view), `household.renamed` and `trip.edited` (before/after views), `invite.created` (after `{expiresAt}`), `member.joined` (after `{userId}`), `member.left` and `member.removed` (before `{userId}`, actor is the remover) and `household.archived` (after `{householdId}`). They are stored as `jsonb`; the audit endpoint is MAZ-58's.

## Imported data

Imported SQLite households work unchanged: `household_trips` became the trip range, `household_members` and their periods became `household_member_periods`, and imported invite hashes still admit a join with their original code. Integration tests import the synthetic `LegacyDatabase` and, through HTTP with imported sessions, list and read the imported trip household (including the former OIDC member's imported `joinedOn` and `leftAt`), join with an imported invite, rejoin a former member (the imported period is kept), leave, remove and archive after settling an imported month, and confirm the creator's personal trip link survives.

## Deliberate differences from the legacy service

- **Archived households.** Archiving now deletes outstanding invites, and a code for an archived household answers `400 Invite code is invalid or expired.` (legacy answered the same status with the misleading `Household currency must match your ledger currency.`).
- **Concurrency.** Legacy SQLite serialized every write globally (`BEGIN IMMEDIATE` in one process); PostgreSQL serializes per household and per member ledger with row locks, with the same outcomes.
- **Stored text.** Names containing NUL or unpaired UTF-16 surrogates are invalid (`400 Invalid household data.`) because PostgreSQL text cannot hold them; route ids containing them are `404`. Same rule as the ledger.
- **Ordering ties.** Households created in the same millisecond are ordered by id (legacy order was unspecified).
- **Rate limit.** The invite limit is configurable (`Auth__InviteRateLimitPermits`, default 20) and sends `Retry-After` without the draft-8 `RateLimit` headers.
- **Period end.** A period never ends before it began (a guard against clock differences between instances); legacy SQLite had no such check.
- Instants are stored as `timestamptz` truncated to whole milliseconds, so responses keep the legacy millisecond values.
