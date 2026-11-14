using System.Text.Json;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Errors;
using Penny.Backend.Domain.Households;

namespace Penny.Backend.Application.Households;

// Shared recurring rule list, create, update and delete. Messages, failure kinds and
// the order of checks are part of the client contract; see
// docs/reference/shared-recurrence.md. Every write runs in
// one transaction that locks the household row, then the payer's ledger row when it
// validates an account, then compare-and-increments the rule, and writes its audit
// row before commit. Occurrences are recorded by SharedRecurrenceRunner.
public sealed class SharedRecurrenceService(ISharedExpenseRepository expenses, TimeProvider clock)
{
    public const string RuleNotFound = "Recurring rule not found.";
    public const string RuleChanged = "Recurring rule changed. Refresh and try again.";
    public const string PayerNotCurrent = "Payer must be a current member.";

    // GET /api/households/{id}/recurring: any membership (archived households too);
    // a former member gets no rules.
    public Task<IReadOnlyList<SharedRuleView>> ListAsync(
        string householdId,
        string userId,
        CancellationToken cancellationToken
    ) =>
        expenses.ReadAsync<IReadOnlyList<SharedRuleView>>(
            async store =>
            {
                var membership = await SharedExpenseService.HistoricalMemberAsync(
                    store,
                    householdId,
                    userId
                );
                if (!membership.IsCurrent)
                    return [];
                return
                [
                    .. (await store.ListRulesAsync(householdId)).Select(rule =>
                        SharedRuleView.From(rule, userId)
                    ),
                ];
            },
            cancellationToken
        );

    public async Task<SharedRuleView> CreateAsync(
        string householdId,
        string actorId,
        JsonElement? body,
        CancellationToken cancellationToken
    )
    {
        var input = ExpenseReader.ReadRecurring(body);
        var now = Now();
        return await expenses.WriteAsync(
            async store =>
            {
                // Access is checked before the body.
                await SharedExpenseService.RequireMemberAsync(store, householdId, actorId);
                if (input is null)
                    throw new BackendFailure(FailureKind.Invalid, HouseholdService.InvalidData);
                var template = input.Template;
                await SharedExpenseService.ValidateAccountAsync(
                    store,
                    template.PayerUserId,
                    actorId,
                    template.AccountId
                );
                await SharedExpenseService.ValidateReceiptAsync(
                    store,
                    householdId,
                    actorId,
                    template.ReceiptId
                );
                await ValidateSplitAsync(store, householdId, template);
                var ruleId = SharedExpenseService.NewId();
                await store.AddRuleAsync(
                    ruleId,
                    householdId,
                    Record(input, template.AccountId, input.NextDate, input.NextDate.Day, true),
                    actorId
                );
                var created = SharedRuleView.From(
                    await FindAsync(store, householdId, ruleId)
                        ?? throw new InvalidOperationException("Rule disappeared inside its lock."),
                    actorId
                );
                await AuditAsync(
                    store,
                    householdId,
                    actorId,
                    "recurring.created",
                    null,
                    created.ForAudit(),
                    now
                );
                return created;
            },
            cancellationToken
        );
    }

    // PUT: edits with the revision the client last saw. The anchor day survives edits
    // that keep the next date and frequency; resuming a paused rule without choosing
    // a new date skips the occurrences that fell due while it was paused.
    public async Task<SharedRuleView> UpdateAsync(
        string householdId,
        string actorId,
        string ruleId,
        JsonElement? body,
        CancellationToken cancellationToken
    )
    {
        var update = ExpenseReader.ReadRecurringUpdate(body);
        var now = Now();
        return await expenses.WriteAsync(
            async store =>
            {
                await SharedExpenseService.RequireMemberAsync(store, householdId, actorId);
                if (update is null)
                    throw new BackendFailure(FailureKind.Invalid, HouseholdService.InvalidData);
                var input = update.Input;
                var template = input.Template;
                await SharedExpenseService.ValidateReceiptAsync(
                    store,
                    householdId,
                    actorId,
                    template.ReceiptId
                );
                await ValidateSplitAsync(store, householdId, template);
                var stored =
                    await FindAsync(store, householdId, ruleId)
                    ?? throw new BackendFailure(FailureKind.NotFound, RuleNotFound);
                if (stored.Revision != update.Revision)
                    throw new BackendFailure(FailureKind.Conflict, RuleChanged);
                // Another member's edit keeps the payer's private account; the payer
                // replaces or clears it.
                var accountId =
                    template.AccountId
                    ?? (
                        !string.Equals(actorId, template.PayerUserId, StringComparison.Ordinal)
                        && string.Equals(
                            stored.Values.PayerId,
                            template.PayerUserId,
                            StringComparison.Ordinal
                        )
                            ? stored.Values.AccountId
                            : null
                    );
                await SharedExpenseService.ValidateAccountAsync(
                    store,
                    template.PayerUserId,
                    actorId,
                    template.AccountId
                );
                var anchor = RecurringDates.Anchor(
                    input.NextDate,
                    input.Frequency,
                    stored.Values.NextDate,
                    stored.Values.Frequency,
                    stored.Values.AnchorDay
                );
                var nextDate =
                    update.Active
                    && !stored.Values.Active
                    && input.NextDate == stored.Values.NextDate
                        ? RecurringDates.FirstOnOrAfter(
                            input.NextDate,
                            input.Frequency,
                            anchor,
                            Today(now)
                        )
                        : input.NextDate;
                if (
                    !await store.UpdateRuleAsync(
                        householdId,
                        ruleId,
                        update.Revision,
                        Record(input, accountId, nextDate, anchor, update.Active)
                    )
                )
                    throw new BackendFailure(FailureKind.Conflict, RuleChanged);
                var after = SharedRuleView.From(
                    await FindAsync(store, householdId, ruleId)
                        ?? throw new InvalidOperationException("Rule disappeared inside its lock."),
                    actorId
                );
                await AuditAsync(
                    store,
                    householdId,
                    actorId,
                    "recurring.updated",
                    new
                    {
                        id = stored.Id,
                        title = stored.Values.Title,
                        active = stored.Values.Active,
                        revision = stored.Revision,
                    },
                    after.ForAudit(),
                    now
                );
                return after;
            },
            cancellationToken
        );
    }

    // DELETE with `{revision}`: removes the rule; recorded occurrences stay, with
    // their `recurringId`.
    public async Task DeleteAsync(
        string householdId,
        string actorId,
        string ruleId,
        JsonElement? body,
        CancellationToken cancellationToken
    )
    {
        var revision = ExpenseReader.ReadRevision(body);
        var now = Now();
        await expenses.WriteAsync(
            async store =>
            {
                await SharedExpenseService.RequireMemberAsync(store, householdId, actorId);
                if (revision is not { } expected)
                    throw new BackendFailure(FailureKind.Invalid, HouseholdService.InvalidData);
                var stored =
                    await FindAsync(store, householdId, ruleId)
                    ?? throw new BackendFailure(FailureKind.NotFound, RuleNotFound);
                if (
                    stored.Revision != expected
                    || !await store.DeleteRuleAsync(householdId, ruleId, expected)
                )
                    throw new BackendFailure(FailureKind.Conflict, RuleChanged);
                await AuditAsync(
                    store,
                    householdId,
                    actorId,
                    "recurring.deleted",
                    new
                    {
                        id = stored.Id,
                        title = stored.Values.Title,
                        revision = stored.Revision,
                    },
                    null,
                    now
                );
                return true;
            },
            cancellationToken
        );
    }

    // Order: the payer is a current member, then the split is valid for the
    // current members (a rule is validated against today's household).
    private static async Task ValidateSplitAsync(
        ISharedExpenseTransaction store,
        string householdId,
        ExpenseInput template
    )
    {
        var memberIds = await store.CurrentMemberIdsAsync(householdId);
        if (!memberIds.Contains(template.PayerUserId, StringComparer.Ordinal))
            throw new BackendFailure(FailureKind.Invalid, PayerNotCurrent);
        ExpenseSplit.Allocate(
            template.TotalCents,
            template.SplitMode,
            memberIds,
            template.Allocations
        );
    }

    // Equal rules store no allocations (any sent are ignored).
    private static RuleRecord Record(
        RecurringInput input,
        string? accountId,
        DateOnly nextDate,
        int anchorDay,
        bool active
    )
    {
        var template = input.Template;
        return new(
            template.Title,
            template.TotalCents,
            template.PayerUserId,
            template.SplitMode,
            string.Equals(template.SplitMode, ExpenseSplit.Equal, StringComparison.Ordinal)
                ? []
                : template.Allocations ?? [],
            template.Category,
            template.Note,
            accountId,
            template.ReceiptId,
            input.Frequency,
            nextDate,
            anchorDay,
            active
        );
    }

    private static Task<StoredRule?> FindAsync(
        ISharedExpenseTransaction store,
        string householdId,
        string ruleId
    ) =>
        SharedExpenseService.Storable(ruleId)
            ? store.FindRuleAsync(householdId, ruleId)
            : Task.FromResult<StoredRule?>(null);

    // Rule events notify nobody; only expense events fill the push outbox.
    private static Task AuditAsync(
        ISharedExpenseTransaction store,
        string householdId,
        string actorId,
        string action,
        object? before,
        object? after,
        DateTimeOffset now
    ) =>
        store.AuditAsync(
            new(
                SharedExpenseService.NewId(),
                householdId,
                actorId,
                action,
                before is null
                    ? null
                    : JsonSerializer.Serialize(before, SharedExpenseService.AuditJson),
                after is null
                    ? null
                    : JsonSerializer.Serialize(after, SharedExpenseService.AuditJson),
                now
            )
        );

    // Server calendar day (UTC), as the runner uses.
    internal static DateOnly Today(DateTimeOffset now) => DateOnly.FromDateTime(now.UtcDateTime);

    private DateTimeOffset Now() => MembershipDates.Truncate(clock.GetUtcNow());
}
