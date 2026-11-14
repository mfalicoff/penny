using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Diagnostics;
using Penny.Backend.Domain.Households;

namespace Penny.Backend.Application.Households;

// Records due shared recurring occurrences, safely with any
// number of runners and restarts:
//
// 1. Claim: one short transaction leases up to BatchSize due rules (active, next date
//    on or before today's UTC date, unarchived household, no live lease) with a fresh
//    token. A lease expires after Lease, so a crashed runner's rules are taken over.
// 2. Step: each occurrence is one READ COMMITTED transaction that locks the household
//    row (the lock rule and expense writers take), re-reads the rule, and stops unless
//    the rule is still active, due and leased to this token. It then advances the
//    rule's next date with a compare-and-increment conditioned on the token and the
//    date it read (extending the lease) and, when the date has no occurrence yet and
//    the payer is a member on it, inserts the expense, its splits, its search
//    document, its `expense.created` audit row and push outbox rows. Everything
//    commits together or not at all; the unique (recurring_id, expense_date) index
//    backs the "no occurrence yet" check.
// 3. Release: the lease is cleared after the rule is caught up. A failed rule keeps
//    its lease, so it is retried once the lease expires instead of in a tight loop.
//
// Catch-up records every missed date in order (each with that date's membership), up
// to MaxStepsPerClaim per claim. Push delivery from the outbox is MAZ-61's and is at
// least once; the stored occurrence and its event rows exist exactly once.
public sealed class SharedRecurrenceRunner(ISharedExpenseRepository expenses, TimeProvider clock)
{
    public const int BatchSize = 16;
    public const int MaxStepsPerClaim = 400;
    public const int MaxPasses = 1000;
    public static readonly TimeSpan Lease = TimeSpan.FromMinutes(2);

    // Identifies this process in `lease_owner` for diagnostics; never authorization.
    public static readonly string Owner = $"{Environment.MachineName}/{Environment.ProcessId}";

    // One pass: claims due rules and catches each up. Cancellation stops between and
    // inside steps; the open step rolls back and its lease expires.
    public async Task<RecurrenceRun> RunOnceAsync(CancellationToken cancellationToken)
    {
        var token = SharedExpenseService.NewId();
        var now = clock.GetUtcNow();
        var claims = await expenses.ClaimRulesAsync(
            Owner,
            token,
            SharedRecurrenceService.Today(now),
            now,
            now + Lease,
            BatchSize,
            cancellationToken
        );
        var recorded = 0;
        var failures = new List<string>();
        using var activity =
            claims.Count > 0
                ? BackendTelemetry.StartJob(BackendTelemetry.RecurrenceJob, claims.Count)
                : null;
        foreach (var claim in claims)
        {
            // Occurrence dates are UTC days, owed from the start of the day.
            BackendTelemetry.JobPickedUp(
                BackendTelemetry.RecurrenceJob,
                now - new DateTimeOffset(claim.NextDate, TimeOnly.MinValue, TimeSpan.Zero)
            );
            try
            {
                recorded += await CatchUpAsync(claim, token, cancellationToken);
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                failures.Add(error.GetType().Name);
                BackendTelemetry.Failed(activity, error.GetType().Name);
                continue;
            }
            await expenses.ReleaseRuleAsync(claim.RuleId, token, cancellationToken);
        }
        return new(claims.Count, recorded, failures);
    }

    // Passes until nothing is due (tests and maintenance); returns the occurrences
    // recorded.
    public async Task<int> RunUntilIdleAsync(CancellationToken cancellationToken)
    {
        var total = 0;
        for (var pass = 0; pass < MaxPasses; pass++)
        {
            var run = await RunOnceAsync(cancellationToken);
            total += run.Recorded;
            if (run.Claimed == 0 || run.Failures.Count > 0)
                break;
        }
        return total;
    }

    private async Task<int> CatchUpAsync(
        RuleClaim claim,
        string token,
        CancellationToken cancellationToken
    )
    {
        var recorded = 0;
        for (var step = 0; step < MaxStepsPerClaim; step++)
        {
            var (created, more) = await expenses.WriteAsync(
                store => StepAsync(store, claim, token),
                cancellationToken
            );
            recorded += created ? 1 : 0;
            if (!more)
                break;
        }
        return recorded;
    }

    // One occurrence date of one rule, inside one transaction. Returns whether an
    // expense was recorded and whether the rule may be due again.
    private async Task<(bool Created, bool More)> StepAsync(
        ISharedExpenseTransaction store,
        RuleClaim claim,
        string token
    )
    {
        var now = Now();
        var today = SharedRecurrenceService.Today(now);
        if (!await store.LockAsync(claim.HouseholdId))
            return (false, false);
        var rule = await store.FindRuleAsync(claim.HouseholdId, claim.RuleId);
        if (
            rule is not { Values.Active: true }
            || !string.Equals(rule.LeaseToken, token, StringComparison.Ordinal)
            || rule.Values.NextDate > today
        )
            return (false, false);
        var values = rule.Values;
        var day = values.NextDate;
        var next = RecurringDates.Next(day, values.Frequency, values.AnchorDay);
        var occurrence = await OccurrenceAsync(store, rule, day);
        // The compare-and-increment comes after the ledger lock (the documented lock
        // order) and before any insert, so a lost lease writes nothing.
        if (!await store.AdvanceRuleAsync(rule.Id, token, day, next, now + Lease))
            return (false, false);
        if (occurrence is not null)
            await RecordAsync(store, occurrence, now);
        return (occurrence is not null, next <= today);
    }

    // The expense the rule records on `day`, or null when the date is already
    // consumed (recorded or deleted occurrence) or the payer is not a member on it.
    private static async Task<ExpenseRecord?> OccurrenceAsync(
        ISharedExpenseTransaction store,
        StoredRule rule,
        DateOnly day
    )
    {
        if ((await store.OccurrenceDatesAsync(rule.Id, day, day)).Count > 0)
            return null;
        var values = rule.Values;
        var active = MembershipWindow.ActiveOn(
            (await store.PeriodsAsync(rule.HouseholdId)).Select(period =>
                MembershipWindow.From(
                    period.UserId,
                    period.JoinedAt,
                    period.JoinedOn,
                    period.LeftAt,
                    0
                )
            ),
            day
        );
        if (!active.Contains(values.PayerId, StringComparer.Ordinal))
            return null;
        var (shares, mode) = ExpenseSplit.Occurrence(
            values.TotalCents,
            values.SplitMode,
            values.Allocations,
            active
        );
        // Ledger check 4 keeps a linked account from being deleted; an account that
        // that is gone anyway is dropped rather than blocking the rule.
        var accountId =
            values.AccountId is { } account
            && await store.LockLedgerAccountAsync(values.PayerId, account)
                ? account
                : null;
        return new(
            rule.HouseholdId,
            values.Title,
            values.TotalCents,
            day,
            values.PayerId,
            mode,
            values.Category,
            values.Note,
            accountId,
            null,
            shares,
            rule.Id
        );
    }

    // An occurrence is created as the payer: the payer is the actor, so
    // every other current member gets a push outbox row.
    private static async Task RecordAsync(
        ISharedExpenseTransaction store,
        ExpenseRecord occurrence,
        DateTimeOffset now
    )
    {
        var expenseId = SharedExpenseService.NewId();
        await store.AddExpenseAsync(expenseId, occurrence, occurrence.PayerId, now);
        var created = await SharedExpenseService.ViewAsync(
            store,
            occurrence.HouseholdId,
            expenseId,
            occurrence.PayerId
        );
        await store.IndexExpenseAsync(expenseId);
        await SharedExpenseService.AuditAsync(
            store,
            occurrence.HouseholdId,
            occurrence.PayerId,
            "expense.created",
            null,
            created.ForAudit(),
            expenseId,
            created.Date,
            now
        );
    }

    private DateTimeOffset Now() => MembershipDates.Truncate(clock.GetUtcNow());
}
