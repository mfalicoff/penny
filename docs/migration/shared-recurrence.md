# Shared recurrence and background processing (MAZ-59)

The .NET backend serves the legacy shared recurring rule operations (`server/infrastructure/households.ts` `recurring`, `createRecurring`, `updateRecurring`, `deleteRecurring`) and replaces the legacy in-process `runRecurring` timer with a PostgreSQL-backed runner that is safe across restarts and multiple processes. Paths, envelopes (`src/data/households.ts` `HouseholdRecurring`), status codes, messages and check order match the legacy server, except for the [deliberate differences](#deliberate-differences-from-the-legacy-service) below. Node still serves production, so `contracts/openapi.json` keeps `x-implementation: legacy` for these operations.

Code: `Domain/Households` (`RecurringDates`, `ExpenseReader.ReadRecurring*`, `ExpenseSplit.Occurrence`), `Application/Households/SharedRecurrenceService` (rule rules, check order, audit) and `SharedRecurrenceRunner` (claims, occurrence steps), `Persistence/Repositories/PostgresSharedExpenseRepository` (claim/release) and `PostgresSharedExpenseTransaction` (rule rows, advance), `Api/Controllers/HouseholdRecurringController`, `Api/Households/SharedRecurrenceWorker`. Tests: `UnitTests/Households/RecurringDatesTests` and `RecurringReaderTests`, and the real-PostgreSQL `IntegrationTests/Controllers/SharedRecurrenceTests` (HTTP), `SharedRecurrenceRunnerTests` (calendar and membership semantics) and `SharedRecurrenceConcurrencyTests` (competing workers, lease takeover, killed and cancelled connections, hosted worker).

No schema change: `household_recurring` already had its lease columns (`lease_owner`, `lease_token`, `lease_expires_at`), the partial due index `ix_household_recurring_due` and the unique occurrence index `(recurring_id, expense_date)` from MAZ-52. No raw SQL was added.

## Endpoints

All operations require a session (cookie or bearer). Errors use `{error: string}`.

| Operation | Route | Success | Who |
| --- | --- | --- | --- |
| `getApiHouseholdsIdRecurring` | `GET /api/households/{id}/recurring` | `200 {rules}` | Current members (archived households too); former members get `{rules: []}` |
| `postApiHouseholdsIdRecurring` | `POST /api/households/{id}/recurring` | `201 {rule}` | Current members of an unarchived household |
| `putApiHouseholdsIdRecurringRuleid` | `PUT /api/households/{id}/recurring/{ruleId}` with `{..., active, revision}` | `200 {rule}` | Current members |
| `deleteApiHouseholdsIdRecurringRuleid` | `DELETE /api/households/{id}/recurring/{ruleId}` with `{revision}` | `200 {ok:true}` | Current members |

A rule is `{id, householdId, title, totalCents, payerUserId, splitMode, allocations?, category, note, accountId?, receiptId?, frequency, nextDate, anchorDay, active, revision}`. `allocations` is present for exact (`{userId, amountCents}`) and percentage (`{userId, percentBasisPoints}`) rules, ordered by member id. `accountId` is the payer's private account and appears only in the payer's own view, never in audit. Lists are ordered by next date, then id.

The body is the shared `expenseInput` without `date`, plus `nextDate` (a real day 2000-01-01..2100-12-31) and `frequency` (`weekly`, `monthly`, `yearly`); updates add `active` (boolean) and `revision`. A `date` field is ignored. Schema failures are `400 Invalid household data.`.

| Operation | Checks in order |
| --- | --- |
| List | any membership (`404 Household not found.`) → current member, else `{rules: []}` |
| Create | current member, unarchived (`404 Household not found.`) → body (`400`) → account (`403 Only the payer can attach a payment account.` / `400 Payment account not found.`) → receipt (`400 Receipt is not available to this household.`) → payer is a current member (`400 Payer must be a current member.`) → split against the current members (the [shared-expense split messages](shared-expenses.md#validation-and-check-order)) |
| Update | current member (`404`) → body (`400`) → receipt → payer current → split → rule in this household (`404 Recurring rule not found.`) → revision (`409 Recurring rule changed. Refresh and try again.`) → account |
| Delete | current member (`404`) → `{revision}` (`400`) → rule (`404 Recurring rule not found.`) → revision (`409 Recurring rule changed. Refresh and try again.`) |

Another member's edit keeps the payer's account; the payer's own edit without an account clears it (as for expenses). Deleting a rule removes it and its allocations; recorded occurrences keep their `recurringId`. Rule writes record `recurring.created` (after: rule view without `accountId`), `recurring.updated` (before `{id, title, active, revision}`, after: rule view) and `recurring.deleted` (before `{id, title, revision}`) audit rows in the same transaction. Rule events never fill the push outbox (legacy).

## Recurrence semantics

- **Calendar.** Dates are calendar days. Weekly adds seven days. Monthly and yearly move to the target month and use the **anchor day** clamped to that month's length: a rule anchored on the 31st records Jan 31, Feb 28 (Feb 29 in leap years), Mar 31, Apr 30; a yearly rule from Feb 29 records Feb 28 in common years and Feb 29 again in the next leap year. The anchor is set from `nextDate` when a rule is created, and kept by edits that leave `nextDate` and `frequency` unchanged, so a rule advanced to Feb 28 still returns to the 31st. Choosing a new `nextDate` or frequency re-anchors on that date's day.
- **Due.** An occurrence is due once its date is on or before the server's **UTC** calendar day (the legacy runner used `new Date().toISOString().slice(0, 10)`). A rule for Jan 10 is recorded from 00:00 UTC on Jan 10, which is the evening of Jan 9 in the Americas.
- **Catch-up.** A rule whose `nextDate` is in the past (created with a past date, or the worker was down) records every missed date in order, each with that date's membership, then continues normally. A pass records up to 400 dates per rule before releasing it to the next pass.
- **Pause and resume.** A paused rule (`active: false`) records nothing and keeps its `nextDate`. Resuming it **with the unchanged `nextDate`** moves it to the first anchored date on or after today (UTC), so the dates that fell due while paused are skipped; resuming with an explicitly different `nextDate` uses that date (and catches up from it if it is in the past).
- **Participants.** Each occurrence is split among the members active on its date (the same windows as [shared expenses](shared-expenses.md#eligible-members-historical-participant-sets); periods without a local join day use UTC). The rule's exact/percentage split applies while exactly the same members are active; otherwise the occurrence is split equally. A rule whose stored split cannot be applied (for example imported allocations that no longer add up) is split equally. Trips use the same date-based membership, so recorded occurrences match their projection previews.
- **Payer.** A date on which the payer is not an active member records nothing; the rule still advances. The occurrence is created by the payer (`createdBy`/`updatedBy`, audit actor) with the rule's title, total, category, note and the payer's account (dropped if the account no longer exists in the payer's ledger). Rule receipts are not copied (legacy).
- **Uniqueness.** A date with an existing occurrence of the rule, **including a soft-deleted one**, is consumed and never recorded again (the unique `(recurring_id, expense_date)` index backs this).
- **Archived households** never record: archiving is final and their rules are never claimed.
- **Projection.** Month previews (`scheduled`) are unchanged from MAZ-57; once an occurrence is recorded it appears in `transactions` and its date is consumed, so it is never counted twice.

## Background processing

`SharedRecurrenceRunner` replaces the legacy 60-second `setInterval(runRecurring)`, which ran every due rule in one SQLite transaction.

1. **Claim.** One short statement pair leases up to 16 due rules (active, `next_date` on or before today UTC, unarchived household, no live lease), earliest first, to a fresh random token: `lease_owner` (`host/pid`, diagnostics only), `lease_token`, `lease_expires_at = now + 2 minutes`. It is an EF `ExecuteUpdate` conditioned on the due predicate, so a competing claim waits on the row lock, re-checks the predicate against the winner's lease and skips the row: two runners never hold the same rule. An expired lease is taken over.
2. **Step.** Each occurrence date is one READ COMMITTED transaction: lock the household row (the lock every rule and expense writer takes first) → re-read the rule and stop unless it is still active, due and leased to this token → (when an expense will be recorded) lock the payer's `ledgers` row to validate the account → compare-and-increment the rule (`next_date = @read AND lease_token = @token`; it advances `next_date`, increments `revision` and extends the lease) → insert the expense, splits, search document (MAZ-121), `expense.created` audit row and one push outbox row per other current member. Everything commits together or not at all. A lost lease or a rule changed under the lock writes nothing.
3. **Release.** When the rule is caught up the lease is cleared. A rule that failed keeps its lease, so it is retried after the lease expires rather than in a tight loop.

Lock order matches [PostgreSQL concurrency](postgresql.md#concurrency-and-transactions): household → payer ledger → rule/expense rows. Ledger saves never lock households, so the runner cannot deadlock with them.

**Exactly once vs at least once.** The stored occurrence, its splits, its audit event, its outbox rows and its search document exist exactly once per (rule, date): they are written in the transaction that advances the rule, guarded by the lease token and the unique index. Delivering outbox rows as push notifications (MAZ-61) happens after commit and is **at least once**: a delivery may repeat, so receivers must tolerate duplicates (the payload's `eventId` identifies the event).

**Recovery.**

| Failure | Outcome |
| --- | --- |
| Process dies or connection drops before commit | PostgreSQL rolls the step back (no expense, audit, outbox or search row; `next_date` and `revision` unchanged). The lease expires after 2 minutes and any runner retries the date. |
| Commit succeeds but the acknowledgment is lost | The retry re-reads the rule under the household lock: `next_date` has advanced (and the date is consumed), so nothing is duplicated. |
| Runner stalls past its lease while another takes over | The stalled runner's compare-and-increment fails on the token, so it writes nothing; the new owner records the date once. |
| Cancellation (host shutdown) | The open step rolls back; the lease expires and the next process continues. |
| Rule edited, paused or deleted while leased | The edit takes the household lock first; the runner re-reads under the same lock and uses the latest rule (or stops). |

## Deployment topology

- The worker runs inside the API process (`SharedRecurrenceWorker`, a hosted service) and polls every `Recurrence__PollSeconds` (default 60, as legacy) while idle, and back to back while a full batch was claimed. **Any number of API replicas may run it**; leases keep them apart, so no singleton or leader election is needed.
- `Recurrence__Worker=false` disables it in a process (for example on API replicas when a dedicated worker replica runs the same image). At least one process must run it, or occurrences stop being recorded; previews still show what is owed and catch-up records every missed date once a worker is back.
- During the cutover freeze, the Node timer and every .NET worker must be stopped together with other writers ([cutover](postgresql.md#cutover-and-forward-only-recovery)); never run the Node `runRecurring` against data that .NET also serves.
- Shutdown cancels the pass; `Backend__ShutdownTimeoutSeconds` bounds the drain.

## Operational diagnostics

Logs carry counts and exception types only, never ids, amounts, titles or SQL: `Recorded {Occurrences} shared recurring occurrences from {Rules} rules` (Information), `A shared recurring rule failed ({ExceptionType}); it is retried after its lease expires` and `Shared recurrence pass failed ({ExceptionType}); it will be retried` (Warning). Read-only checks with the runtime role:

```sql
-- Overdue rules (should be empty a few minutes after a worker is running).
SELECT count(*), min(next_date) FROM penny.household_recurring r JOIN penny.households h ON h.id = r.household_id
WHERE r.active AND h.archived_at IS NULL AND r.next_date < (now() AT TIME ZONE 'UTC')::date;
-- Live and expired leases by worker.
SELECT lease_owner, count(*), max(lease_expires_at) FROM penny.household_recurring WHERE lease_token IS NOT NULL GROUP BY lease_owner;
-- Unsent push outbox rows (delivery is MAZ-61).
SELECT count(*), min(created_at) FROM penny.push_outbox WHERE sent_at IS NULL;
```

A rule that keeps failing shows a lease that is renewed every two minutes by different owners and a repeating warning; fix the data (for example its payer's ledger) and it continues. Never clear `lease_*` columns by hand while a worker may be running; an expired lease is taken over automatically.

## Deliberate differences from the legacy service

- **Paused rules skip the paused period.** Legacy caught up every date missed while a rule was paused when it was resumed; .NET resumes at the first anchored date on or after today unless the client sends a different `nextDate`.
- **The runner increments the rule revision** when it advances `nextDate` (legacy changed `next_date` without a revision). A client editing a stale copy gets `409 Recurring rule changed. Refresh and try again.` instead of silently rewinding `nextDate` and re-anchoring the rule.
- **Anchors survive edits.** Legacy reset `anchor_day` to the day of `nextDate` on every update, so an edit after a short month lost the 31st; .NET keeps it while `nextDate` and `frequency` are unchanged.
- **Create/update responses** return the stored rule (with `anchorDay`, ordered allocations and the effective `nextDate`/`accountId`) instead of echoing the request; `timezoneOffsetMinutes` is not echoed.
- **Equal rules store no allocations** (legacy stored and ignored them).
- **Failures are isolated per rule.** Legacy ran all rules in one transaction, so one bad rule (a deleted payer account, an archived household, a trip payer who had left) failed every rule on every tick. .NET skips archived households, drops a missing account, splits unusable rules equally and retries a failing rule after its lease without blocking others.
- **Trip occurrences** use the members active on the date, like the projection preview (legacy split by date but checked the payer against current members).
- **Catch-up limit.** Legacy stopped after 366 dates per rule per tick; .NET records up to 400 per claim and continues in the next pass.
