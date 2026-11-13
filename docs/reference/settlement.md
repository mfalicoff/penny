# Monthly settlement, reimbursements and audit history (MAZ-58)

The .NET API serves the month recap, monthly reimbursement and audit operations with the paths, envelopes, status codes and messages of `contracts/openapi.json`, in a fixed check order. See the [behavior notes](#behavior-notes) below.

Code: `Domain/Households/MonthlySettlement` (balances, suggestions, month-end cutoff, overdue rule), `ExpenseReader.ReadReimbursement`, `Application/Households/SettlementService` (rules, check order, audit, outbox) and `AuditRedaction`, `Persistence/Repositories/PostgresSharedExpenseTransaction` (reimbursement and audit queries) and `PostgresHouseholdTransaction.ContributionsAsync` (per-month balance rows), `Api/Controllers/HouseholdSettlementController`. Tests: `UnitTests/Households/MonthlySettlementTests` (golden cases shared with TypeScript, cutoff boundaries, overdue rule, body reader) and `AuditRedactionTests`; real-PostgreSQL `IntegrationTests/Controllers/SettlementTests`, `SettlementConcurrencyTests` and `AuditTests`.

No schema change: the MAZ-52 tables (`household_reimbursements`, `household_audit`, `push_outbox`) and indexes already hold everything. No raw SQL was added.

## Endpoints

All operations require a session (cookie or bearer). Errors use `{error: string}`.

| Operation | Route | Success | Who |
| --- | --- | --- | --- |
| `getApiHouseholdsIdMonthsMonth` | `GET /api/households/{id}/months/{month}` | `200 MonthRecap` (no envelope) | Current members; former members up to the month they left in. Archived households stay readable |
| `postApiHouseholdsIdMonthsMonthReimbursements` | `POST /api/households/{id}/months/{month}/reimbursements` with `{fromUserId, toUserId, amountCents}` | `201 {reimbursement}` | The debtor or the creditor of a current suggestion, current member of an unarchived household |
| `getApiHouseholdsIdAudit` | `GET /api/households/{id}/audit[?expenseId=]` | `200 {events}` | Current and former members, also after archiving |

- `MonthRecap` is `{month, expenses, reimbursements, balances, suggestions, overdue, overdueMonths}`. `expenses` are the [expense views](shared-expenses.md#endpoints) the caller can see, newest first. `reimbursements` are `{id, householdId, month, fromUserId, toUserId, amountCents, createdBy, createdAt, expenseId?}`, oldest first (then id); `expenseId` marks an individual expense payment. `balances` are `{userId, balanceCents}` ordered by id; `suggestions` are `{fromUserId, toUserId, amountCents}`; `overdueMonths` are ascending `YYYY-MM`.
- An audit event is `{id, householdId, expenseId?, actorId, action, before, after, createdAt}`; `before`/`after` are the stored JSON snapshots or `null`. Instants are Unix milliseconds.

## Validation and check order

| Operation | Checks in order |
| --- | --- |
| Month recap | any membership, archived or not (`404 Household not found.`) → `month` matches `YYYY-MM` (`400 Invalid household data.`) → a former member asks for a month after the one they left in (`404 Month not found.`) |
| Reimbursement | current member of an unarchived household (`404 Household not found.`) → `month` (`400 Invalid household data.`) → body: ids 1–100 characters, `amountCents` a safe integer 1–99,999,999,999 (`400 Invalid household data.`) → two different members (`400 Choose two different members.`) → caller is `fromUserId` or `toUserId` (`403 Only people involved can record a reimbursement.`) → today (UTC) is the month's last day or later (`409 Record reimbursements on the last day of the month or later.`) → exactly matches a current suggestion: same debtor, creditor and amount (`409 This is no longer the full suggested reimbursement.`) |
| Audit | any membership, archived or not (`404 Household not found.`) |

Body rules are the reimbursement schema with the shared JSON rules (unknown keys ignored, no `null`, safe integers, storable text). Malformed JSON is `400 Invalid JSON.`. Path and query values: an empty or repeated `expenseId` means the whole household.

## Balances and suggestions

Integer cents only; months are independent, so a credit in one month never offsets a debt in another.

- **Balance** (`calculateMonthlyBalances` in `src/domain/households.ts`): within the month, the payer of each live (not deleted) expense is credited its total and every split member is debited their share; every reimbursement of the month — monthly reimbursements and individual expense payments alike — credits the sender and debits the recipient. Every member with a row in the month is listed, including zero balances (a member with a zero share still took part). Balances always net to zero.
- **Suggestions** (`suggestReimbursements`): debtors and creditors are each sorted by amount, largest first, ties by member id; the largest debtor pays the largest creditor the smaller of the two amounts, repeatedly. That gives at most debtors + creditors − 1 **full** transfers. Golden cases (partial and complete settlement, ignored months and deleted expenses, zero shares, tie-breaks, the largest totals) live in `contracts/fixtures/settlement.json` and are consumed by `tests/core/households-domain.test.ts` and the .NET `MonthlySettlementTests`.
- **Reports are never inflated.** Reimbursements and expense payments settle balances only: they are never spending, never appear in the personal projection, never create search documents and never change expense splits.

## Settlement timing

- **UTC month-end cutoff.** A month can be settled with a monthly reimbursement from its last calendar day (UTC) onward: for September, from `2026-09-30T00:00:00Z`, which is still 8 p.m. on Sep 29 in Toronto. Before then the month is still open (`409`). Leap years and month lengths follow the calendar (`2028-02-29`). Earlier months can be settled any time later.
- **Overdue.** `overdue` is true when the month is earlier than the current UTC month and still has a suggestion. `overdueMonths` lists every such month the caller can see, up to the month a former member left in, so the client can show separate overdue months instead of one merged debt.
- **Individual payments close.** Once a month has a monthly reimbursement, `paymentsClosed` becomes true for every expense of that month and individual share payments answer `409 This month already has monthly reimbursements. Settle the remaining monthly balance instead.` ([shared expenses](shared-expenses.md#individual-payments)). Payments made before stay; the monthly suggestion already accounts for them, so the reimbursement pays only the remainder.
- **Editing a settled month** remains possible for unpaid expenses. The month's balances then show the remaining difference and a new suggestion appears; settled shares are never rewritten.

## Membership and archive restrictions

Leaving, removal and archiving use the same per-month balances (MAZ-56): a member may leave or be removed only with a zero balance in every month, and a household may be archived only when every member is settled in every month. Archived households accept no reimbursements (`404`), but their recaps and audit stay readable. A former member keeps exactly their own history:

- recaps only for months up to the UTC month they left in (`404 Month not found.` after it);
- only the expenses they have a share in (zero shares included), and reimbursements recorded by the time they left or that they sent or received;
- balances, suggestions and overdue months computed from those same rows.

## Transactions, locking, idempotency and recovery

- **One transaction, household lock first.** A reimbursement runs in one READ COMMITTED transaction (`PostgresSharedExpenseRepository.WriteAsync`) that first locks the household row — the lock every expense, payment, rule and membership writer takes — then re-checks membership, recomputes the month's balances and suggestions from committed rows, inserts the reimbursement and writes its audit and push outbox rows. A failure, cancellation or timeout rolls back everything.
- **Repeated and concurrent submissions.** A suggestion is only matched while it is still owed, so the second of two identical submissions (a double tap, a retry after a lost response, or the debtor and creditor recording the same transfer at once) waits for the lock and then gets `409 This is no longer the full suggested reimbursement.` Nothing is ever recorded twice. The same lock serializes a monthly reimbursement against an individual payment (the loser gets `409` from whichever check now fails), against an expense edit (the month nets to zero either way; a later edit exposes the remaining difference) and against a leave (a member never leaves with an unsettled balance).
- **Stale-payment recovery.** A `409` means the client's recap is stale: the client re-reads `GET .../months/{month}` and offers the current suggestions (the redesign's stale-payment state). A request that timed out is safe to re-read and, if the transfer is still suggested, to retry. The server never retries.
- **Read consistency.** Recaps and audit reads use one REPEATABLE READ snapshot, so expenses, reimbursements, balances and overdue months always describe the same state.

Verified with real PostgreSQL (`SettlementConcurrencyTests`): three identical concurrent submissions (exactly one row, one audit row, zero balances), monthly reimbursement against an individual payment, against an expense edit and against the debtor leaving, each repeated in several months.

## Audit history

- **Writes.** A monthly reimbursement records `reimbursement.created` (after: the reimbursement, without `expenseId`; the row's `expense_id` is null) and one `push_outbox` row for every other current member with entity id = event id and payload `{householdId, month, eventId}`; delivery is [push](push.md). Every other event is written by its own operation in the same transaction ([households](households.md#audit), [shared expenses](shared-expenses.md#audit-and-outbox), [shared recurrence](shared-recurrence.md)).
- **Reads.** Newest first; events with the same instant come later-written first (`sort_order`). The household history returns at most 500 events; `?expenseId=` returns all of that expense's events in this household (no limit), including an `expense.moved` out of it or an `expense.created` for a move into it.
- **Visibility.** Current members see every event. A former member sees the events of expenses they have a share in (while the expense belongs to this household, deleted ones included) and household events recorded by the time they left.
- **Private-data redaction.** Snapshots are written without the payer's private `accountId` and without receipt filenames, which are encrypted at rest. Every snapshot is redacted again when it is read — top-level `accountId` and `receipt.name` are removed — so older rows never expose them. `receiptId` and `receipt.{id, mime, uri}` remain; client change history uses only `receiptId`.

## Behavior notes

- **Former members' audit limit.** Events a former member may not see are filtered out first, then the newest 500 visible events are returned.
- **A former member's own `member.left`** is recorded at the same instant as the leave, so the member always sees it (`AuditTests.whenMemberLeft_Audit_ShouldShowOnlyTheirHistory`).
- **Audit redaction on read** removes `accountId` and `receipt.name` from every snapshot returned.
- **Ordering ties.** Reimbursements with the same instant are ordered by id; balances and suggestion ties use ordinal id order.
- **Concurrency.** PostgreSQL serializes writes per household.
