# Shared expenses, splits and personal projections (MAZ-57)

The .NET backend serves the legacy shared-expense operations (`server/infrastructure/households.ts`, `server/http/households.ts`): expense list, read, create, update (including moves between households), soft delete, individual share payments and the personal projection. Paths, envelopes (`src/data/households.ts`), status codes, messages and check order match the legacy server, except for the [deliberate differences](#deliberate-differences-from-the-legacy-service) below. Node still serves production, so `contracts/openapi.json` keeps `x-implementation: legacy` for these operations.

Code: `Domain/Households` (`HouseholdSplits`, `ExpenseSplit`, `ExpenseReader`, `MembershipWindow`, `RecurringDates`), `Application/Households/SharedExpenseService` (rules, check order, audit, outbox), `Persistence/Repositories/PostgresSharedExpenseRepository` and `PostgresSharedExpenseTransaction` (transactions, locks, compare-and-increment), `Api/Controllers/HouseholdExpensesController`. Tests: `UnitTests/Households` (golden splits, readers, membership windows, recurrence dates) and the real-PostgreSQL `IntegrationTests/Controllers/SharedExpense*Tests`, `HouseholdProjectionTests` and `Migrations/ImportedSharedExpenseTests`.

Not part of this port: month recaps, monthly reimbursements and the audit endpoint (MAZ-58), shared recurring rule writes and the occurrence runner (MAZ-59), receipt upload/download (MAZ-60), push delivery (MAZ-61) and search (MAZ-121). Those routes still answer `404 API route not found.` in .NET.

## Endpoints

All operations require a session (cookie or bearer). Errors use `{error: string}`.

| Operation | Route | Success | Who |
| --- | --- | --- | --- |
| `getApiHouseholdsIdExpenses` | `GET /api/households/{id}/expenses?month=YYYY-MM` | `200 {expenses}` | Current members (all live expenses); former members (only expenses they have a share in). Archived households stay readable |
| `getApiHouseholdsIdExpensesExpenseid` | `GET /api/households/{id}/expenses/{expenseId}` | `200 {expense}` | As above |
| `postApiHouseholdsIdExpenses` | `POST /api/households/{id}/expenses` | `201 {expense}` | Current members of an unarchived household |
| `putApiHouseholdsIdExpensesExpenseid` | `PUT /api/households/{id}/expenses/{expenseId}` | `200 {expense}` | Current members; a move needs membership of both households |
| `deleteApiHouseholdsIdExpensesExpenseid` | `DELETE /api/households/{id}/expenses/{expenseId}` with `{revision}` | `200 {ok:true}` | Current members |
| `postApiHouseholdExpensePayment` | `POST /api/households/{id}/expenses/{expenseId}/payments` with `{fromUserId, revision}` | `201 {expense}` | The debtor, or the payer on the debtor's behalf |
| `getApiHouseholdsProjection` | `GET /api/households/projection?month=YYYY-MM` or `?year=YYYY` | `200 {transactions, scheduled}` | Any signed-in user (their own shares only) |

An expense is `{id, householdId, title, totalCents, date, payerUserId, splitMode, splits, payments, paymentsClosed, category, note, accountId?, receiptId?, receipt?, revision, createdBy, createdAt, updatedBy, updatedAt, recurringId?}`. Instants are Unix milliseconds. `splits` are `{userId, amountCents}` ordered by member id; `payments` are `{fromUserId, amountCents, createdAt, createdBy}` ordered by time, then debtor; `paymentsClosed` is true once the expense's month has a monthly reimbursement. Lists are ordered by date, then creation, newest first (then id).

Query parameters follow Express: an empty or repeated `month`/`year` is treated as absent.

## Validation and check order

Request bodies follow the legacy zod `expenseInput`: `title` trimmed 1–100, `totalCents` 1–99,999,999,999, `date` a real day 2000-01-01..2100-12-31, `payerUserId`, `splitMode` `equal`/`exact`/`percent`, optional `allocations` (at most 100; each `{userId, amountCents ≥ 0}` or `{userId, percentBasisPoints 0–10000}` — like the zod union, the amount shape is tried first), `category {name trimmed 1–50, icon ≤ 80, color #RRGGBB}`, `note` ≤ 1000 (default empty), optional `accountId`, `receiptId`, `timezoneOffsetMinutes` (−840..720). Unknown keys are ignored, optional fields may be absent but never `null`, numbers must be JavaScript safe integers. A schema failure is `400 Invalid household data.`; malformed JSON is `400 Invalid JSON.`.

| Operation | Checks in order |
| --- | --- |
| List / read | any membership (`404 Household not found.`) → list: `month` matches `YYYY-MM` (`400 Invalid household data.`) → read: live expense visible to the caller (`404 Expense not found.`) |
| Create | current member, unarchived (`404 Household not found.`) → body (`400`) → payer eligible on the date (`400 The payer must be a current household member.`) → account (`403 Only the payer can attach a payment account.` / `400 Payment account not found.`) → receipt (`400 Receipt is not available to this household.`) → split (below) |
| Update | current member (`404`) → body (`400`) → destination membership when moving (`404 Household not found.`) → live expense (`404 Expense not found.`) → revision (`409 Expense changed. Refresh and try again.`) → paid expense keeps payer, total, month and household (`409 Paid expenses cannot change payer, total, month or household.`) → destination currency (`400 The destination must use the same currency.`) → payer eligible (unpaid only) → account → receipt (when it changes or the expense stays) → split → paid shares unchanged (`409 Paid expenses cannot change share allocations.`) |
| Delete | current member (`404`) → `{revision}` (`400`) → live expense (`404`) → revision (`409`) → no payments (`409 Paid expenses cannot be deleted.`) |
| Payment | body `{fromUserId, revision}` (`400`, checked **before** access, as legacy) → current member (`404`) → live expense (`404 Expense not found.`) → caller is debtor or payer (`403 Only the debtor or expense payer can record this payment.`) → debtor is not the payer (`400 The payer cannot pay their own share.`) → debtor and payer are current members (`404 Household not found.`) → revision (`409`) → month not closed (`409 This month already has monthly reimbursements. Settle the remaining monthly balance instead.`) → share not already paid (`409 This share is already paid.`) → positive share (`400 Choose a member with a positive share.`) |
| Projection | `month` matches `YYYY-MM` (`400 Invalid household data.`) → `year` matches `YYYY` (`400 Invalid year.`) |

Split checks (`ExpenseSplit`): eligible members are distinct and non-empty (`400 Select distinct members.`); equal splits ignore `allocations`; exact and percentage splits need exactly one allocation per eligible member (`400 Provide one split for every eligible member.`) of the right shape (`400 Exact splits need amounts.` / `400 Percentage splits need percentages.`); any calculation failure, including shares that do not add up, is `400 Split shares must add up to the expense total.`

## Split and remainder rules

Integer cents only; no floating point anywhere (`HouseholdSplits`, a port of `calculateHouseholdSplits`).

- **Equal:** members sorted by id (ordinal); each gets `floor(total / n)`; the `total mod n` remainder cents go one each to the lexically first members. 100.00 among three is 33.34, 33.33, 33.33. One cent among three is 1, 0, 0.
- **Exact:** the given amounts (zero allowed) must add up to the total exactly.
- **Percentage:** basis points (10000 = 100%) must add up to 10000. Each share is `floor(total × points / 10000)`, computed as `(total / 10000) × points + (total mod 10000) × points / 10000` so no intermediate exceeds the total; the cents left over go one each to the members with the largest fractional remainders, ties to the lower id. Shares always add up to the total.
- **Zero shares** are recorded (a member with a zero share still takes part: they see the expense, and it stays in their history after they leave).
- Golden cases live in `contracts/fixtures/shared-splits.json` (and `parity-cases.json` `sharedSplits`); the TypeScript domain tests and the .NET unit tests both consume them.

## Eligible members (historical participant sets)

- **Households:** the members active on the expense date. Each membership period gives a window from its local join day (`joinedOn`, or — for older clients without an offset — the join instant shifted by the request's `timezoneOffsetMinutes`, default UTC) up to, but excluding, the UTC day the member left. A member who joined after an expense's date is not in it; a member who left is not in expenses dated on or after their departure day. Rejoining opens a new window.
- **Shared trips:** every current member, whatever the date (bookings often predate the trip and the group).
- **Paid expenses** keep the participants they were paid with: an edit reuses the stored split members, so membership changes cannot rewrite paid shares.
- Splits are snapshots: later membership changes never rewrite an expense, and nobody joining owes anything for earlier expenses.

## Payer privacy

`accountId` is the payer's **private** ledger account. Only the payer can set it (`403` for anyone else) and it must exist in the payer's ledger. It appears only in the payer's own expense views and projection rows; other members never receive it, nor the account's name (which is never stored on shared rows). Another member's edit keeps the payer's account; the payer's own edit without an account clears it. Audit snapshots and push payloads never contain it. Ledger check 6 refuses deleting an account that a live expense or rule links.

## Receipts

A `receiptId` must be the caller's own upload or a receipt a live expense of the same household already shares. When linked, every member who can see the expense receives `receipt {id, name, mime, uri}` (the name is decrypted from the encrypted receipt store; the file is never read here). Moving an expense with an unchanged receipt does not re-check it, as legacy. Receipt download authorization is MAZ-60.

## Revisions, conflicts and soft deletion

- A new expense has revision 0. Every edit, payment and delete compare-and-increments it (`UPDATE … WHERE revision = @expected`); a stale revision is `409 Expense changed. Refresh and try again.` and changes nothing. The server never retries.
- Edits set `updatedBy`/`updatedAt`. Deletes are soft: `deleted_at` is set, the revision increments, `updated_by` is the deleter and `updated_at` is left unchanged (legacy). Splits, payments and history stay; the expense leaves every list, balance and projection.
- A **move** (`targetHouseholdId`) keeps the expense id, needs the same currency and recomputes eligible members in the destination.
- **Paid expenses** (at least one individual payment) cannot change payer, total, month, household or shares and cannot be deleted; title, note, category, receipt, account and day within the month stay editable.

## Individual payments

A payment settles one member's whole share early: it inserts a reimbursement linked to the expense (`expense_id`) from the debtor to the payer for the share amount, in the expense's month, and increments the expense revision. It counts in the month's balance (MAZ-56 settlement) but is never spending, so projections are unchanged. Once the month has a monthly reimbursement (MAZ-58), individual payments are closed for every expense of that month. A unique index on `(expense_id, from_user_id)` backs the already-paid check.

## Personal projection

`GET /api/households/projection` returns the caller's shares of shared expenses as `ProjectedExpense` rows, to show beside the private ledger (`ledgerWithHouseholds`). It never writes.

- **transactions:** one row per live expense in which the caller has a share, in any household they have ever joined (archived included): `{id, householdId, householdName, householdCurrency, title, date, totalCents, shareCents, payerUserId, category, note, receipt?, accountId?}`. `month` filters to that month, `year` to that year, neither returns everything; newest first.
- **scheduled** (month only, otherwise `[]`): previews of the occurrences active shared rules would record in that month, for households the caller currently belongs to (not archived). Each occurrence uses the members active on its date: the rule's stored exact/percentage split while exactly the same members are active, otherwise an equal split; the payer must be active. Dates already recorded by the rule, including soft-deleted occurrences, are consumed and never previewed. Rows carry `scheduled: true`, `recurringId` and id `ruleId:date`. Rule writes and the runner are MAZ-59.
- **No double counting:** shared rows are never copied into the personal ledger and the personal ledger is not included here; each expense appears once per viewer (membership is an `EXISTS`, so a member with several periods is not counted twice); payments and reimbursements never appear as spending; recorded occurrences replace their previews.
- **Visibility:** only rows with the caller's own share; former members keep exactly their own history and lose scheduled previews; outsiders get `{transactions: [], scheduled: []}`. `accountId` only for the payer.

## Transactions, locking and concurrency

Every write runs in one READ COMMITTED transaction (`PostgresSharedExpenseRepository.WriteAsync`); a failure, cancellation or timeout rolls back everything, including audit and outbox rows. Reads use one REPEATABLE READ snapshot. Lock order (as [documented](postgresql.md#concurrency-and-transactions)):

1. **Household rows first** — the same lock membership writers take (MAZ-56). A move locks both households in ascending id order. Membership and access are re-checked under the lock, so an edit and a leave, removal or archive of the same household serialize: settlement checks always see the splits they are based on, and an edit never commits into an archived household.
2. **The payer's `ledgers` row** when an account is validated (`LockLedgerAccountAsync`). `PUT /api/ledger` compare-and-increments the same row before checking linked accounts, so a concurrent account deletion either commits first (the expense then fails `400 Payment account not found.`) or waits and then fails ledger check 6.
3. **The expense row** via the revision compare-and-increment, then splits and reimbursements.

Ledger saves never lock households, so these writers cannot deadlock with each other or with ledger saves. Row locks use EF `ExecuteUpdate`; no raw SQL is added. Verified with real PostgreSQL: concurrent edits of one revision (exactly one wins, the other gets 409), concurrent deletes (one wins, the other gets 404), edit against delete, edit against a member leaving (never a former member with an unsettled share), edit against archive (never an unsettled archived household) and create against ledger account deletion (never a link to a missing account).

## Audit and outbox

Each write records its legacy audit row in the same transaction, with `expense_id`: `expense.created` (after: expense view), `expense.updated` (before/after), `expense.deleted` (before), `expense.moved` in the source household (before) plus `expense.created` in the destination (after), and `reimbursement.created` for payments (after: `{id, householdId, month, fromUserId, toUserId, amountCents, createdBy, createdAt, expenseId}`). Snapshots never include the payer's `accountId` or the receipt's encrypted filename. Created, updated and payment events also insert one `push_outbox` row per other current member (`{householdId, month, expenseId, eventId}`), exactly as legacy; delivery is MAZ-61. The audit endpoint is MAZ-58.

## Search (MAZ-121)

No search projection exists yet; MAZ-121 owns its schema and indexing. `SharedExpenseService` marks the seams in create, update/move and delete: when MAZ-121 adds shared-expense search documents it must update them **inside these transactions, before commit**, together with the membership seams MAZ-56 marked in join, leave/removal and archive, so search visibility changes exactly when expenses, splits or membership do. Search must index only fields each viewer may see and never the payer's account.

## Imported data

Imported SQLite expenses work unchanged through HTTP (`ImportedSharedExpenseTests`): the imported trip household's expense keeps its revision, splits, individual payment, `recurringId` and Unicode text; the former member still reads it and sees their share in the projection; the creator previews the imported percentage rule (split equally because the other member left); paid-expense protections apply; a metadata edit increments the imported revision; new expenses link the imported receipt (name decrypted) and the creator's imported account.

## Deliberate differences from the legacy service

- **Former-member projections.** Legacy answered `404 Expense not found.` from the projection when a household the caller had left recorded an expense without them in the requested period. .NET returns only the caller's own shares, as the projection intends.
- **Percentage tie-break.** Equal leftovers go to the lower id by ordinal comparison; legacy used `localeCompare`. Both give the same order for generated (lower-case hex) and imported ids; they could differ only for ids that differ in letter case or punctuation.
- **Audit snapshots** omit `receipt.name`, because receipt filenames are encrypted at rest (MAZ-52). `receiptId` and `receipt.{id, mime, uri}` remain; the legacy client's change history uses only `receiptId`.
- **Ordering ties.** Expenses with the same date and creation instant are ordered by id; projection rows (legacy: by date only) are ordered by date, creation, id.
- **Concurrency.** Legacy SQLite serialized every write globally; PostgreSQL serializes per household (both households for a move) and per payer ledger, with the same outcomes.
- **Stored text.** Strings containing NUL or unpaired UTF-16 surrogates are invalid (`400 Invalid household data.`); such route ids match nothing (`404`).
- **Receipt URI** escapes the id (`/api/receipts/{id}`), identical for generated ids.
- **Corrupt rules.** A stored exact/percentage rule without allocations previews as an equal split; legacy failed the whole projection with a 500.
