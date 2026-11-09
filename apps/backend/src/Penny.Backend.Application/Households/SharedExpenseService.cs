using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Errors;
using Penny.Backend.Domain.Households;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Application.Households;

// Port of the legacy shared-expense operations and the personal projection
// (server/infrastructure/households.ts: expenses, getExpense, createExpense,
// updateExpense, deleteExpense, payExpense, projection). Messages, failure kinds and
// the order of checks are part of the client contract; deviations are listed in
// docs/migration/shared-expenses.md. Every write runs in one transaction that first
// locks the household row (both rows, in id order, for a move), then the payer's
// ledger row when it validates a payment account, re-checks access inside the lock,
// compare-and-increments the expense revision and writes its audit (and push outbox)
// rows before commit.
public sealed class SharedExpenseService(ISharedExpenseRepository expenses, TimeProvider clock)
{
    public const string ExpenseNotFound = "Expense not found.";
    public const string PayerNotMember = "The payer must be a current household member.";
    public const string PayerOnlyAccount = "Only the payer can attach a payment account.";
    public const string AccountNotFound = "Payment account not found.";
    public const string ReceiptUnavailable = "Receipt is not available to this household.";
    public const string Changed = "Expense changed. Refresh and try again.";
    public const string PaidLocked =
        "Paid expenses cannot change payer, total, month or household.";
    public const string DestinationCurrency = "The destination must use the same currency.";
    public const string PaidShares = "Paid expenses cannot change share allocations.";
    public const string PaidDelete = "Paid expenses cannot be deleted.";
    public const string PaymentForbidden =
        "Only the debtor or expense payer can record this payment.";
    public const string PayerOwnShare = "The payer cannot pay their own share.";
    public const string PaymentsClosed =
        "This month already has monthly reimbursements. Settle the remaining monthly balance instead.";
    public const string AlreadyPaid = "This share is already paid.";
    public const string PositiveShare = "Choose a member with a positive share.";
    public const string InvalidYear = "Invalid year.";

    private const string Created = "expense.created";
    private const string Updated = "expense.updated";

    private static readonly JsonSerializerOptions AuditJson = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    // GET /api/households/{id}/expenses: current and former members (also after
    // archiving). A former member sees only the expenses they have a share in.
    public Task<IReadOnlyList<ExpenseView>> ListAsync(
        string householdId,
        string userId,
        string? month,
        CancellationToken cancellationToken
    ) =>
        expenses.ReadAsync<IReadOnlyList<ExpenseView>>(
            async store =>
            {
                var membership = await HistoricalMemberAsync(store, householdId, userId);
                if (month is not null && !ExpenseReader.IsMonth(month))
                    throw new BackendFailure(FailureKind.Invalid, HouseholdService.InvalidData);
                return
                [
                    .. (await store.ListExpensesAsync(householdId, month))
                        .Where(expense => CanSee(membership, expense, userId))
                        .Select(expense => ExpenseView.From(expense, userId)),
                ];
            },
            cancellationToken
        );

    public Task<ExpenseView> GetAsync(
        string householdId,
        string userId,
        string expenseId,
        CancellationToken cancellationToken
    ) =>
        expenses.ReadAsync(
            async store =>
            {
                var membership = await HistoricalMemberAsync(store, householdId, userId);
                var expense = await FindAsync(store, householdId, expenseId);
                return expense is not null && CanSee(membership, expense, userId)
                    ? ExpenseView.From(expense, userId)
                    : throw new BackendFailure(FailureKind.NotFound, ExpenseNotFound);
            },
            cancellationToken
        );

    public async Task<ExpenseView> CreateAsync(
        string householdId,
        string actorId,
        JsonElement? body,
        CancellationToken cancellationToken
    )
    {
        var input = ExpenseReader.ReadInput(body);
        var now = Now();
        return await expenses.WriteAsync(
            async store =>
            {
                // Access is checked before the body, as in the legacy route.
                var household = await RequireMemberAsync(store, householdId, actorId);
                if (input is null)
                    throw new BackendFailure(FailureKind.Invalid, HouseholdService.InvalidData);
                var memberIds = await EligibleAsync(store, household, input);
                if (!memberIds.Contains(input.PayerUserId, StringComparer.Ordinal))
                    throw new BackendFailure(FailureKind.Invalid, PayerNotMember);
                await ValidateAccountAsync(store, input.PayerUserId, actorId, input.AccountId);
                await ValidateReceiptAsync(store, householdId, actorId, input.ReceiptId);
                var shares = ExpenseSplit.Allocate(
                    input.TotalCents,
                    input.SplitMode,
                    memberIds,
                    input.Allocations
                );
                var expenseId = NewId();
                await store.AddExpenseAsync(
                    expenseId,
                    Record(householdId, input, input.AccountId, shares),
                    actorId,
                    now
                );
                var created = await ViewAsync(store, householdId, expenseId, actorId);
                // Search seam (MAZ-121): index the new expense and its shares for the
                // members who may see it, here, before commit.
                await AuditAsync(
                    store,
                    householdId,
                    actorId,
                    Created,
                    null,
                    created.ForAudit(),
                    expenseId,
                    created.Date,
                    now
                );
                return created;
            },
            cancellationToken
        );
    }

    // PUT: edits with the revision the client last saw; `targetHouseholdId` moves the
    // expense (same id) to another household of the same currency. Paid expenses keep
    // their payer, total, month, household and shares; metadata stays editable.
    public async Task<ExpenseView> UpdateAsync(
        string householdId,
        string actorId,
        string expenseId,
        JsonElement? body,
        CancellationToken cancellationToken
    )
    {
        var update = ExpenseReader.ReadUpdate(body);
        var now = Now();
        return await expenses.WriteAsync(
            async store =>
            {
                var destinationId = update?.TargetHouseholdId ?? householdId;
                var locked = await LockAsync(store, householdId, destinationId);
                var household = await LockedMemberAsync(store, locked, householdId, actorId);
                if (update is null)
                    throw new BackendFailure(FailureKind.Invalid, HouseholdService.InvalidData);
                var input = update.Input;
                var moving = !string.Equals(destinationId, householdId, StringComparison.Ordinal);
                var destination = moving
                    ? await LockedMemberAsync(store, locked, destinationId, actorId)
                    : household;
                var stored =
                    await FindAsync(store, householdId, expenseId)
                    ?? throw new BackendFailure(FailureKind.NotFound, ExpenseNotFound);
                var before = ExpenseView.From(stored, actorId);
                if (stored.Revision != update.Revision)
                    throw new BackendFailure(FailureKind.Conflict, Changed);
                var paid = stored.Payments.Count > 0;
                if (
                    paid
                    && (
                        moving
                        || !string.Equals(
                            input.PayerUserId,
                            stored.PayerId,
                            StringComparison.Ordinal
                        )
                        || input.TotalCents != stored.TotalCents
                        || Month(input.Date) != Month(stored.Date)
                    )
                )
                    throw new BackendFailure(FailureKind.Conflict, PaidLocked);
                if (
                    moving
                    && !string.Equals(
                        household.Currency,
                        destination.Currency,
                        StringComparison.Ordinal
                    )
                )
                    throw new BackendFailure(FailureKind.Invalid, DestinationCurrency);
                // A paid expense keeps the participants it was paid with.
                IReadOnlyList<string> memberIds = paid
                    ? [.. stored.Splits.Select(share => share.UserId)]
                    : await EligibleAsync(store, destination, input);
                if (!paid && !memberIds.Contains(input.PayerUserId, StringComparer.Ordinal))
                    throw new BackendFailure(FailureKind.Invalid, PayerNotMember);
                // Another member's edit keeps the payer's private account; the payer
                // replaces or clears it.
                var accountId =
                    input.AccountId
                    ?? (
                        !string.Equals(actorId, input.PayerUserId, StringComparison.Ordinal)
                        && string.Equals(
                            stored.PayerId,
                            input.PayerUserId,
                            StringComparison.Ordinal
                        )
                            ? stored.AccountId
                            : null
                    );
                await ValidateAccountAsync(store, input.PayerUserId, actorId, input.AccountId);
                if (
                    !string.Equals(input.ReceiptId, stored.Receipt?.Id, StringComparison.Ordinal)
                    || !moving
                )
                    await ValidateReceiptAsync(store, destinationId, actorId, input.ReceiptId);
                var shares = ExpenseSplit.Allocate(
                    input.TotalCents,
                    input.SplitMode,
                    memberIds,
                    input.Allocations
                );
                if (
                    paid
                    && (
                        shares.Count != stored.Splits.Count
                        || shares.Any(share => !stored.Splits.Contains(share))
                    )
                )
                    throw new BackendFailure(FailureKind.Conflict, PaidShares);
                if (
                    !await store.UpdateExpenseAsync(
                        householdId,
                        expenseId,
                        update.Revision,
                        Record(destinationId, input, accountId, shares),
                        actorId,
                        now
                    )
                )
                    throw new BackendFailure(FailureKind.Conflict, Changed);
                var after = await ViewAsync(store, destinationId, expenseId, actorId);
                // Search seam (MAZ-121): re-index the expense, its shares and, for a
                // move, both households' visibility, here, before commit.
                if (!moving)
                {
                    await AuditAsync(
                        store,
                        householdId,
                        actorId,
                        Updated,
                        before.ForAudit(),
                        after.ForAudit(),
                        expenseId,
                        after.Date,
                        now
                    );
                }
                else
                {
                    await AuditAsync(
                        store,
                        householdId,
                        actorId,
                        "expense.moved",
                        before.ForAudit(),
                        null,
                        expenseId,
                        null,
                        now
                    );
                    await AuditAsync(
                        store,
                        destinationId,
                        actorId,
                        Created,
                        null,
                        after.ForAudit(),
                        expenseId,
                        after.Date,
                        now
                    );
                }
                return after;
            },
            cancellationToken
        );
    }

    // Soft delete: the row, its splits and history stay; it leaves every list,
    // balance and projection. Paid expenses cannot be deleted.
    public async Task DeleteAsync(
        string householdId,
        string actorId,
        string expenseId,
        JsonElement? body,
        CancellationToken cancellationToken
    )
    {
        var revision = ExpenseReader.ReadRevision(body);
        var now = Now();
        await expenses.WriteAsync(
            async store =>
            {
                await RequireMemberAsync(store, householdId, actorId);
                if (revision is not { } expected)
                    throw new BackendFailure(FailureKind.Invalid, HouseholdService.InvalidData);
                var stored =
                    await FindAsync(store, householdId, expenseId)
                    ?? throw new BackendFailure(FailureKind.NotFound, ExpenseNotFound);
                if (stored.Revision != expected)
                    throw new BackendFailure(FailureKind.Conflict, Changed);
                if (stored.Payments.Count > 0)
                    throw new BackendFailure(FailureKind.Conflict, PaidDelete);
                if (!await store.DeleteExpenseAsync(householdId, expenseId, expected, actorId, now))
                    throw new BackendFailure(FailureKind.Conflict, Changed);
                // Search seam (MAZ-121): remove the expense from search, here.
                await AuditAsync(
                    store,
                    householdId,
                    actorId,
                    "expense.deleted",
                    ExpenseView.From(stored, actorId).ForAudit(),
                    null,
                    expenseId,
                    null,
                    now
                );
                return true;
            },
            cancellationToken
        );
    }

    // POST .../payments: the debtor (or the payer on their behalf) pays one whole
    // share early. The payment is a reimbursement linked to the expense; it settles
    // the share in the month's balance and is never spending.
    public async Task<ExpenseView> PayAsync(
        string householdId,
        string actorId,
        string expenseId,
        JsonElement? body,
        CancellationToken cancellationToken
    )
    {
        // The legacy route validates the body before checking access.
        var request =
            ExpenseReader.ReadPayment(body)
            ?? throw new BackendFailure(FailureKind.Invalid, HouseholdService.InvalidData);
        var now = Now();
        return await expenses.WriteAsync(
            async store =>
            {
                await RequireMemberAsync(store, householdId, actorId);
                var stored =
                    await FindAsync(store, householdId, expenseId)
                    ?? throw new BackendFailure(FailureKind.NotFound, ExpenseNotFound);
                if (
                    !string.Equals(actorId, request.FromUserId, StringComparison.Ordinal)
                    && !string.Equals(actorId, stored.PayerId, StringComparison.Ordinal)
                )
                    throw new BackendFailure(FailureKind.Forbidden, PaymentForbidden);
                if (string.Equals(request.FromUserId, stored.PayerId, StringComparison.Ordinal))
                    throw new BackendFailure(FailureKind.Invalid, PayerOwnShare);
                await RequireCurrentAsync(store, householdId, request.FromUserId);
                await RequireCurrentAsync(store, householdId, stored.PayerId);
                if (stored.Revision != request.Revision)
                    throw new BackendFailure(FailureKind.Conflict, Changed);
                if (stored.PaymentsClosed)
                    throw new BackendFailure(FailureKind.Conflict, PaymentsClosed);
                if (
                    stored.Payments.Any(payment =>
                        string.Equals(
                            payment.FromUserId,
                            request.FromUserId,
                            StringComparison.Ordinal
                        )
                    )
                )
                    throw new BackendFailure(FailureKind.Conflict, AlreadyPaid);
                var share = stored.Splits.FirstOrDefault(part =>
                    string.Equals(part.UserId, request.FromUserId, StringComparison.Ordinal)
                );
                if (share is null || share.AmountCents <= 0)
                    throw new BackendFailure(FailureKind.Invalid, PositiveShare);
                var month = Month(stored.Date);
                var payment = new StoredReimbursement(
                    NewId(),
                    householdId,
                    month,
                    request.FromUserId,
                    stored.PayerId,
                    share.AmountCents,
                    actorId,
                    now,
                    expenseId
                );
                if (!await store.AddPaymentAsync(payment, request.Revision))
                    throw new BackendFailure(FailureKind.Conflict, Changed);
                await AuditAsync(
                    store,
                    householdId,
                    actorId,
                    "reimbursement.created",
                    null,
                    new
                    {
                        id = payment.Id,
                        householdId,
                        month,
                        fromUserId = payment.FromUserId,
                        toUserId = payment.ToUserId,
                        amountCents = payment.AmountCents,
                        createdBy = actorId,
                        createdAt = now.ToUnixTimeMilliseconds(),
                        expenseId,
                    },
                    expenseId,
                    month,
                    now
                );
                return await ViewAsync(store, householdId, expenseId, actorId);
            },
            cancellationToken
        );
    }

    // GET /api/households/projection: the caller's shares of recorded shared expenses
    // (`month` YYYY-MM, `year` YYYY or everything) and, for a month, previews of
    // scheduled shared occurrences. Nothing is written. Payments and reimbursements
    // are not spending and never appear; private ledger entries are not included, so
    // a client adds these rows beside its own ledger without double counting.
    public Task<ProjectionView> ProjectionAsync(
        string userId,
        string? month,
        string? year,
        CancellationToken cancellationToken
    )
    {
        if (month is not null && !ExpenseReader.IsMonth(month))
            throw new BackendFailure(FailureKind.Invalid, HouseholdService.InvalidData);
        if (year is not null && !ExpenseReader.IsYear(year))
            throw new BackendFailure(FailureKind.Invalid, InvalidYear);
        return expenses.ReadAsync(
            async store =>
            {
                var range = Range(month ?? year);
                if (range is { Empty: true })
                    return new ProjectionView([], []);
                var transactions = (await store.ProjectionAsync(userId, range?.From, range?.To))
                    .Select(row => Projected(row, userId))
                    .ToList();
                IReadOnlyList<ProjectedExpenseView> scheduled =
                    month is null || range is not { } days
                        ? []
                        : await ScheduledAsync(store, userId, days.From, days.To);
                return new ProjectionView(transactions, scheduled);
            },
            cancellationToken
        );
    }

    private static ProjectedExpenseView Projected(StoredProjectedExpense row, string userId)
    {
        var expense = row.Expense;
        var share = expense.Splits.First(part =>
            string.Equals(part.UserId, userId, StringComparison.Ordinal)
        );
        return new(
            expense.Id,
            expense.HouseholdId,
            row.HouseholdName,
            row.HouseholdCurrency,
            expense.Title,
            LedgerDates.Write(expense.Date),
            expense.TotalCents,
            share.AmountCents,
            expense.PayerId,
            expense.Category,
            expense.Note,
            expense.Receipt is { } receipt
                ? ExpenseReceiptView.From(receipt.Id, receipt.Name, receipt.Mime)
                : null,
            string.Equals(userId, expense.PayerId, StringComparison.Ordinal)
                ? expense.AccountId
                : null,
            null,
            null
        );
    }

    // Previews of occurrences the rules would record in the month, using each
    // occurrence date's membership. Recorded and deleted occurrences are consumed.
    private static async Task<IReadOnlyList<ProjectedExpenseView>> ScheduledAsync(
        ISharedExpenseTransaction store,
        string userId,
        DateOnly first,
        DateOnly last
    )
    {
        var previews = new List<ProjectedExpenseView>();
        var windows = new Dictionary<string, List<MembershipWindow>>(StringComparer.Ordinal);
        foreach (var rule in await store.ScheduledRulesAsync(userId, last))
        {
            if (!windows.TryGetValue(rule.HouseholdId, out var members))
            {
                members =
                [
                    .. (await store.PeriodsAsync(rule.HouseholdId)).Select(period =>
                        MembershipWindow.From(
                            period.UserId,
                            period.JoinedAt,
                            period.JoinedOn,
                            period.LeftAt,
                            0
                        )
                    ),
                ];
                windows[rule.HouseholdId] = members;
            }
            var existing = await store.OccurrenceDatesAsync(rule.Id, first, last);
            DateOnly? next = rule.NextDate;
            while (next is { } day && day <= last)
            {
                next = After(rule, day);
                if (day < first || existing.Contains(day))
                    continue;
                var active = MembershipWindow.ActiveOn(members, day);
                if (!active.Contains(rule.PayerId, StringComparer.Ordinal))
                    continue;
                var share = ExpenseSplit
                    .Recurring(rule.TotalCents, rule.SplitMode, rule.Allocations, active)
                    .Shares.FirstOrDefault(part =>
                        string.Equals(part.UserId, userId, StringComparison.Ordinal)
                    );
                if (share is null)
                    continue;
                var text = LedgerDates.Write(day);
                previews.Add(
                    new(
                        rule.Id + ":" + text,
                        rule.HouseholdId,
                        rule.HouseholdName,
                        rule.HouseholdCurrency,
                        rule.Title,
                        text,
                        rule.TotalCents,
                        share.AmountCents,
                        rule.PayerId,
                        rule.Category,
                        rule.Note,
                        null,
                        string.Equals(rule.PayerId, userId, StringComparison.Ordinal)
                            ? rule.AccountId
                            : null,
                        true,
                        rule.Id
                    )
                );
            }
        }
        return previews;
    }

    // The next occurrence, or null past the last representable date.
    private static DateOnly? After(StoredSharedRule rule, DateOnly date)
    {
        try
        {
            return RecurringDates.Next(date, rule.Frequency, rule.AnchorDay);
        }
        catch (ArgumentOutOfRangeException)
        {
            return null;
        }
    }

    // The calendar days of a `YYYY-MM` month or `YYYY` year; null for no filter.
    // Year 0000 matches the format but no date (expense dates start in 2000).
    private static (DateOnly From, DateOnly To, bool Empty)? Range(string? period)
    {
        if (period is null)
            return null;
        var year = int.Parse(period.AsSpan(0, 4), CultureInfo.InvariantCulture);
        if (year < 1)
            return (default, default, true);
        if (period.Length == 4)
            return (new DateOnly(year, 1, 1), new DateOnly(year, 12, 31), false);
        var month = int.Parse(period.AsSpan(5, 2), CultureInfo.InvariantCulture);
        return (
            new DateOnly(year, month, 1),
            new DateOnly(year, month, DateTime.DaysInMonth(year, month)),
            false
        );
    }

    // Shared trips split among all current members whatever the date (bookings often
    // predate the trip and even the group); households use the members active on the
    // expense date, with the caller's offset for periods without a local join day.
    private static async Task<IReadOnlyList<string>> EligibleAsync(
        ISharedExpenseTransaction store,
        StoredHousehold household,
        ExpenseInput input
    )
    {
        if (household.Trip is not null)
            return await store.CurrentMemberIdsAsync(household.Id);
        var offset = input.TimezoneOffsetMinutes ?? 0;
        return MembershipWindow.ActiveOn(
            (await store.PeriodsAsync(household.Id)).Select(period =>
                MembershipWindow.From(
                    period.UserId,
                    period.JoinedAt,
                    period.JoinedOn,
                    period.LeftAt,
                    offset
                )
            ),
            input.Date
        );
    }

    // Only the payer attaches their own account, and it must be in their ledger. The
    // ledger row stays locked, so the account cannot be deleted before commit.
    private static async Task ValidateAccountAsync(
        ISharedExpenseTransaction store,
        string payerId,
        string actorId,
        string? accountId
    )
    {
        if (accountId is null)
            return;
        if (!string.Equals(payerId, actorId, StringComparison.Ordinal))
            throw new BackendFailure(FailureKind.Forbidden, PayerOnlyAccount);
        if (!await store.LockLedgerAccountAsync(payerId, accountId))
            throw new BackendFailure(FailureKind.Invalid, AccountNotFound);
    }

    // A receipt is the actor's own upload, or one a live expense of the household
    // already shares with its members.
    private static async Task ValidateReceiptAsync(
        ISharedExpenseTransaction store,
        string householdId,
        string actorId,
        string? receiptId
    )
    {
        if (receiptId is null)
            return;
        if (
            !await store.ReceiptOwnedAsync(actorId, receiptId)
            && !await store.ReceiptLinkedAsync(householdId, receiptId)
        )
            throw new BackendFailure(FailureKind.Invalid, ReceiptUnavailable);
    }

    // Legacy `requireMember(..., historical = true)`: any membership, archived or not.
    private static async Task<StoredMember> HistoricalMemberAsync(
        ISharedExpenseTransaction store,
        string householdId,
        string userId
    ) =>
        (
            Storable(householdId) && Storable(userId)
                ? await store.MembershipAsync(householdId, userId)
                : null
        ) ?? throw new BackendFailure(FailureKind.NotFound, HouseholdService.NotFound);

    // Legacy `canSeeExpense`: current members see every expense; former members only
    // those they have a share in.
    private static bool CanSee(StoredMember membership, StoredExpense expense, string userId) =>
        membership.IsCurrent
        || expense.Splits.Any(share =>
            string.Equals(share.UserId, userId, StringComparison.Ordinal)
        );

    // Legacy `requireMember`: a current member of an unarchived household, holding the
    // household lock for the rest of the unit.
    private static async Task<StoredHousehold> RequireMemberAsync(
        ISharedExpenseTransaction store,
        string householdId,
        string userId
    ) =>
        await LockedMemberAsync(
            store,
            await LockAsync(store, householdId, householdId),
            householdId,
            userId
        );

    // Locks the households in ascending id order (the documented lock order) and
    // returns those that exist and are not archived.
    private static async Task<HashSet<string>> LockAsync(
        ISharedExpenseTransaction store,
        string first,
        string second
    )
    {
        var locked = new HashSet<string>(StringComparer.Ordinal);
        foreach (
            var id in new[] { first, second }
                .Where(Storable)
                .Distinct(StringComparer.Ordinal)
                .Order(StringComparer.Ordinal)
        )
            if (await store.LockAsync(id))
                locked.Add(id);
        return locked;
    }

    private static async Task<StoredHousehold> LockedMemberAsync(
        ISharedExpenseTransaction store,
        HashSet<string> locked,
        string householdId,
        string userId
    )
    {
        if (
            locked.Contains(householdId)
            && Storable(userId)
            && await store.MembershipAsync(householdId, userId) is { IsCurrent: true }
        )
            return await store.FindAsync(householdId, includeArchived: false)
                ?? throw new BackendFailure(FailureKind.NotFound, HouseholdService.NotFound);
        throw new BackendFailure(FailureKind.NotFound, HouseholdService.NotFound);
    }

    // A current member of the household already locked by this unit.
    private static async Task RequireCurrentAsync(
        ISharedExpenseTransaction store,
        string householdId,
        string userId
    )
    {
        if (await store.MembershipAsync(householdId, userId) is not { IsCurrent: true })
            throw new BackendFailure(FailureKind.NotFound, HouseholdService.NotFound);
    }

    private static Task<StoredExpense?> FindAsync(
        ISharedExpenseTransaction store,
        string householdId,
        string expenseId
    ) =>
        Storable(expenseId)
            ? store.FindExpenseAsync(householdId, expenseId)
            : Task.FromResult<StoredExpense?>(null);

    private static async Task<ExpenseView> ViewAsync(
        ISharedExpenseTransaction store,
        string householdId,
        string expenseId,
        string viewerId
    ) =>
        ExpenseView.From(
            await store.FindExpenseAsync(householdId, expenseId)
                ?? throw new InvalidOperationException("Expense disappeared inside its lock."),
            viewerId
        );

    private static ExpenseRecord Record(
        string householdId,
        ExpenseInput input,
        string? accountId,
        IReadOnlyList<SplitShare> shares
    ) =>
        new(
            householdId,
            input.Title,
            input.TotalCents,
            input.Date,
            input.PayerUserId,
            input.SplitMode,
            input.Category,
            input.Note,
            accountId,
            input.ReceiptId,
            shares
        );

    // Writes the audit row and, for events that notify (`month` set: created, updated
    // and payment events, as legacy), one push outbox row for every other current
    // member, all in this transaction. The push worker is MAZ-61's.
    private static async Task AuditAsync(
        ISharedExpenseTransaction store,
        string householdId,
        string actorId,
        string action,
        object? before,
        object? after,
        string expenseId,
        string? notifyMonth,
        DateTimeOffset now
    )
    {
        var eventId = NewId();
        await store.AuditAsync(
            new(
                eventId,
                householdId,
                actorId,
                action,
                before is null ? null : JsonSerializer.Serialize(before, AuditJson),
                after is null ? null : JsonSerializer.Serialize(after, AuditJson),
                now,
                expenseId
            )
        );
        if (notifyMonth is null)
            return;
        var month = notifyMonth.Length > 7 ? notifyMonth[..7] : notifyMonth;
        var payload = JsonSerializer.Serialize(
            new
            {
                householdId,
                month,
                expenseId,
                eventId,
            },
            AuditJson
        );
        await store.AddOutboxAsync([
            .. (await store.CurrentMemberIdsAsync(householdId))
                .Where(userId => !string.Equals(userId, actorId, StringComparison.Ordinal))
                .Select(userId => new StoredOutboxMessage(
                    NewId(),
                    userId,
                    householdId,
                    action,
                    expenseId,
                    payload,
                    now
                )),
        ]);
    }

    private static string Month(DateOnly date) =>
        date.ToString("yyyy-MM", CultureInfo.InvariantCulture);

    // Route values that PostgreSQL text cannot hold match nothing.
    private static bool Storable(string id) => LedgerText.IsStorable(id);

    // Legacy `randomId(16)`: 16 random bytes as lower-case hex.
    private static string NewId() => RandomNumberGenerator.GetHexString(32, lowercase: true);

    private DateTimeOffset Now() => MembershipDates.Truncate(clock.GetUtcNow());
}
