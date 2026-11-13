using System.Text.Json;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Errors;
using Penny.Backend.Domain.Households;

namespace Penny.Backend.Application.Households;

// Port of the legacy monthly settlement and audit reads
// (server/infrastructure/households.ts: month, recap, reimburse, audit). Messages,
// failure kinds and the order of checks are part of the client contract; deviations
// are listed in docs/migration/settlement.md. A reimbursement runs in one transaction
// that first locks the household row (the lock every expense, payment and membership
// writer takes), re-checks access, recomputes the month's suggestions under the lock
// and writes the reimbursement, its audit row and push outbox rows before commit, so
// a repeated or concurrent submission can never settle a month twice.
public sealed class SettlementService(ISharedExpenseRepository expenses, TimeProvider clock)
{
    public const string MonthNotFound = "Month not found.";
    public const string SameMember = "Choose two different members.";
    public const string NotInvolved = "Only people involved can record a reimbursement.";
    public const string MonthOpen = "Record reimbursements on the last day of the month or later.";
    public const string NotSuggested = "This is no longer the full suggested reimbursement.";

    // Legacy `audit()` returns at most this many household events (an expense's
    // history is not limited).
    public const int AuditLimit = 500;

    // GET /api/households/{id}/months/{month}: current and former members, also after
    // archiving. A former member sees months up to the one they left in, only the
    // expenses they have a share in, and reimbursements recorded before they left or
    // involving them; balances, suggestions and overdue months use the same rows.
    public Task<MonthRecapView> MonthAsync(
        string householdId,
        string userId,
        string month,
        CancellationToken cancellationToken
    )
    {
        var now = clock.GetUtcNow();
        return expenses.ReadAsync(
            async store =>
            {
                var membership = await SharedExpenseService.HistoricalMemberAsync(
                    store,
                    householdId,
                    userId
                );
                if (!ExpenseReader.IsMonth(month))
                    throw new BackendFailure(FailureKind.Invalid, HouseholdService.InvalidData);
                var former = membership.LeftAt is { } leftAt
                    ? new FormerMember(userId, leftAt)
                    : null;
                var leftMonth = former is null ? null : MonthlySettlement.MonthOf(former.LeftAt);
                if (leftMonth is not null && string.CompareOrdinal(month, leftMonth) > 0)
                    throw new BackendFailure(FailureKind.NotFound, MonthNotFound);
                var visible = (await store.ListExpensesAsync(householdId, month))
                    .Where(expense => SharedExpenseService.CanSee(membership, expense, userId))
                    .Select(expense => ExpenseView.From(expense, userId))
                    .ToList();
                var reimbursements = (await store.ListReimbursementsAsync(householdId, month))
                    .Where(reimbursement => former is null || Visible(reimbursement, former))
                    .Select(ReimbursementView.From)
                    .ToList();
                var contributions = former is null
                    ? await store.BalancesAsync(householdId)
                    : await store.VisibleBalancesAsync(householdId, former);
                var balances = MonthlySettlement.Balances(month, contributions);
                var suggestions = MonthlySettlement.Suggest(balances);
                var currentMonth = MonthlySettlement.MonthOf(now);
                // Every month with a non-zero balance has suggestions (balances net to
                // zero), so overdue months are the earlier unsettled ones.
                var overdueMonths = MonthlySettlement
                    .UnsettledMonths(contributions)
                    .Where(other =>
                        string.CompareOrdinal(other, currentMonth) < 0
                        && (leftMonth is null || string.CompareOrdinal(other, leftMonth) <= 0)
                    )
                    .ToList();
                return new MonthRecapView(
                    month,
                    visible,
                    reimbursements,
                    balances,
                    suggestions,
                    MonthlySettlement.IsOverdue(month, currentMonth, suggestions.Count > 0),
                    overdueMonths
                );
            },
            cancellationToken
        );
    }

    // POST /api/households/{id}/months/{month}/reimbursements: one of the two members
    // records a full suggested transfer, on the month's last UTC day or later. The
    // suggestion is recomputed under the household lock, so a duplicate (or a payment,
    // expense edit or other reimbursement that committed first) gets 409.
    public async Task<ReimbursementView> ReimburseAsync(
        string householdId,
        string actorId,
        string month,
        JsonElement? body,
        CancellationToken cancellationToken
    )
    {
        var request = ExpenseReader.ReadReimbursement(body);
        var now = Now();
        return await expenses.WriteAsync(
            async store =>
            {
                await SharedExpenseService.RequireMemberAsync(store, householdId, actorId);
                if (!ExpenseReader.IsMonth(month) || request is null)
                    throw new BackendFailure(FailureKind.Invalid, HouseholdService.InvalidData);
                if (string.Equals(request.FromUserId, request.ToUserId, StringComparison.Ordinal))
                    throw new BackendFailure(FailureKind.Invalid, SameMember);
                if (
                    !string.Equals(actorId, request.FromUserId, StringComparison.Ordinal)
                    && !string.Equals(actorId, request.ToUserId, StringComparison.Ordinal)
                )
                    throw new BackendFailure(FailureKind.Forbidden, NotInvolved);
                if (!MonthlySettlement.CanRecord(month, DateOnly.FromDateTime(now.UtcDateTime)))
                    throw new BackendFailure(FailureKind.Conflict, MonthOpen);
                var suggestions = MonthlySettlement.Suggest(
                    MonthlySettlement.Balances(month, await store.BalancesAsync(householdId))
                );
                if (
                    !suggestions.Any(suggestion =>
                        string.Equals(
                            suggestion.FromUserId,
                            request.FromUserId,
                            StringComparison.Ordinal
                        )
                        && string.Equals(
                            suggestion.ToUserId,
                            request.ToUserId,
                            StringComparison.Ordinal
                        )
                        && suggestion.AmountCents == request.AmountCents
                    )
                )
                    throw new BackendFailure(FailureKind.Conflict, NotSuggested);
                var reimbursement = new StoredReimbursement(
                    SharedExpenseService.NewId(),
                    householdId,
                    month,
                    request.FromUserId,
                    request.ToUserId,
                    request.AmountCents,
                    actorId,
                    now,
                    null
                );
                await store.AddReimbursementAsync(reimbursement);
                var view = ReimbursementView.From(reimbursement);
                await SharedExpenseService.AuditAsync(
                    store,
                    householdId,
                    actorId,
                    "reimbursement.created",
                    null,
                    view,
                    null,
                    month,
                    now
                );
                return view;
            },
            cancellationToken
        );
    }

    // GET /api/households/{id}/audit[?expenseId=]: current and former members, also
    // after archiving. Newest first; the household history is limited to 500 events.
    public Task<IReadOnlyList<AuditEventView>> AuditAsync(
        string householdId,
        string userId,
        string? expenseId,
        CancellationToken cancellationToken
    ) =>
        expenses.ReadAsync<IReadOnlyList<AuditEventView>>(
            async store =>
            {
                var membership = await SharedExpenseService.HistoricalMemberAsync(
                    store,
                    householdId,
                    userId
                );
                // An id PostgreSQL text cannot hold matches no event.
                if (expenseId is not null && !SharedExpenseService.Storable(expenseId))
                    return [];
                var viewer = membership.LeftAt is { } leftAt
                    ? new FormerMember(userId, leftAt)
                    : null;
                return
                [
                    .. (
                        await store.AuditEventsAsync(
                            householdId,
                            expenseId,
                            viewer,
                            expenseId is null ? AuditLimit : null
                        )
                    ).Select(entry => new AuditEventView(
                        entry.Id,
                        entry.HouseholdId,
                        entry.ExpenseId,
                        entry.ActorId,
                        entry.Action,
                        AuditRedaction.Redact(entry.BeforeJson),
                        AuditRedaction.Redact(entry.AfterJson),
                        entry.CreatedAt.ToUnixTimeMilliseconds()
                    )),
                ];
            },
            cancellationToken
        );

    // A former member keeps reimbursements recorded by the time they left, and those
    // they sent or received.
    private static bool Visible(StoredReimbursement reimbursement, FormerMember viewer) =>
        reimbursement.CreatedAt <= viewer.LeftAt
        || string.Equals(reimbursement.FromUserId, viewer.UserId, StringComparison.Ordinal)
        || string.Equals(reimbursement.ToUserId, viewer.UserId, StringComparison.Ordinal);

    private DateTimeOffset Now() => MembershipDates.Truncate(clock.GetUtcNow());
}
