using Microsoft.EntityFrameworkCore;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Households;
using Penny.Backend.Persistence.Receipts;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;
using Penny.Backend.Persistence.Search;

namespace Penny.Backend.Persistence.Repositories;

// Shared expenses inside one household unit of work. Revisions are
// compare-and-increment `ExecuteUpdate` statements on the expense row (the matching
// row stays locked until commit); household and ledger locks come from the base
// class. Text is ordered in memory with ordinal comparison, never by the database
// collation, so ordering matches the legacy SQLite byte order for generated ids.
internal sealed class PostgresSharedExpenseTransaction(
    PennyDbContext context,
    ReceiptFileStore files,
    CancellationToken cancellationToken
) : PostgresHouseholdTransaction(context, cancellationToken), ISharedExpenseTransaction
{
    public async Task<IReadOnlyList<StoredPeriod>> PeriodsAsync(string householdId) =>
        await Context
            .HouseholdMemberPeriods.AsNoTracking()
            .Where(period => period.HouseholdId == householdId)
            .Select(period => new StoredPeriod(
                period.UserId,
                period.JoinedAt,
                period.JoinedOn,
                period.LeftAt
            ))
            .ToListAsync(Cancellation);

    public async Task<IReadOnlyList<string>> CurrentMemberIdsAsync(string householdId) =>
        [
            .. (
                await Context
                    .HouseholdMemberPeriods.AsNoTracking()
                    .Where(period => period.HouseholdId == householdId && period.LeftAt == null)
                    .Select(period => period.UserId)
                    .Distinct()
                    .ToListAsync(Cancellation)
            ).Order(StringComparer.Ordinal),
        ];

    public async Task<bool> LockLedgerAccountAsync(string userId, string accountId) =>
        await LockLedgerAsync(userId)
        && await Context.LedgerAccounts.AnyAsync(
            account => account.UserId == userId && account.Id == accountId,
            Cancellation
        );

    public Task<bool> ReceiptOwnedAsync(string userId, string receiptId) =>
        Context.Receipts.AnyAsync(
            receipt => receipt.Id == receiptId && receipt.UserId == userId,
            Cancellation
        );

    public Task<bool> ReceiptLinkedAsync(string householdId, string receiptId) =>
        Context.HouseholdExpenses.AnyAsync(
            expense =>
                expense.HouseholdId == householdId
                && expense.ReceiptId == receiptId
                && expense.DeletedAt == null,
            Cancellation
        );

    public async Task<StoredExpense?> FindExpenseAsync(string householdId, string expenseId) =>
        (
            await LoadAsync(
                Context.HouseholdExpenses.Where(expense =>
                    expense.Id == expenseId
                    && expense.HouseholdId == householdId
                    && expense.DeletedAt == null
                )
            )
        ).SingleOrDefault();

    public async Task<IReadOnlyList<StoredExpense>> ListExpensesAsync(
        string householdId,
        string? month
    )
    {
        var query = Context.HouseholdExpenses.Where(expense =>
            expense.HouseholdId == householdId && expense.DeletedAt == null
        );
        if (month is not null)
        {
            var first = DateOnly.ParseExact(
                month + "-01",
                "yyyy-MM-dd",
                System.Globalization.CultureInfo.InvariantCulture
            );
            var last = first.AddMonths(1).AddDays(-1);
            query = query.Where(expense =>
                expense.ExpenseDate >= first && expense.ExpenseDate <= last
            );
        }
        return Newest(await LoadAsync(query));
    }

    public async Task AddExpenseAsync(
        string expenseId,
        ExpenseRecord record,
        string actorId,
        DateTimeOffset now
    )
    {
        Context.HouseholdExpenses.Add(
            new HouseholdExpense
            {
                Id = expenseId,
                HouseholdId = record.HouseholdId,
                Title = record.Title,
                TotalCents = record.TotalCents,
                ExpenseDate = record.Date,
                PayerId = record.PayerId,
                SplitMode = record.SplitMode,
                CategoryName = record.Category.Name,
                CategoryIcon = record.Category.Icon,
                CategoryColor = record.Category.Color,
                Note = record.Note,
                AccountId = record.AccountId,
                ReceiptId = record.ReceiptId,
                Revision = 0,
                CreatedBy = actorId,
                CreatedAt = now,
                UpdatedBy = actorId,
                UpdatedAt = now,
                RecurringId = record.RecurringId,
            }
        );
        AddSplits(expenseId, record.Splits);
        await Context.SaveChangesAsync(Cancellation);
    }

    public async Task<bool> UpdateExpenseAsync(
        string householdId,
        string expenseId,
        long revision,
        ExpenseRecord record,
        string actorId,
        DateTimeOffset now
    )
    {
        var updated = await Live(householdId, expenseId, revision)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(expense => expense.HouseholdId, record.HouseholdId)
                        .SetProperty(expense => expense.Title, record.Title)
                        .SetProperty(expense => expense.TotalCents, record.TotalCents)
                        .SetProperty(expense => expense.ExpenseDate, record.Date)
                        .SetProperty(expense => expense.PayerId, record.PayerId)
                        .SetProperty(expense => expense.SplitMode, record.SplitMode)
                        .SetProperty(expense => expense.CategoryName, record.Category.Name)
                        .SetProperty(expense => expense.CategoryIcon, record.Category.Icon)
                        .SetProperty(expense => expense.CategoryColor, record.Category.Color)
                        .SetProperty(expense => expense.Note, record.Note)
                        .SetProperty(expense => expense.AccountId, record.AccountId)
                        .SetProperty(expense => expense.ReceiptId, record.ReceiptId)
                        .SetProperty(expense => expense.Revision, expense => expense.Revision + 1)
                        .SetProperty(expense => expense.UpdatedBy, actorId)
                        .SetProperty(expense => expense.UpdatedAt, now),
                Cancellation
            );
        if (updated != 1)
            return false;
        await Context
            .HouseholdSplits.Where(split => split.ExpenseId == expenseId)
            .ExecuteDeleteAsync(Cancellation);
        AddSplits(expenseId, record.Splits);
        await Context.SaveChangesAsync(Cancellation);
        return true;
    }

    // Legacy soft delete: `updated_at` is left as it was.
    public async Task<bool> DeleteExpenseAsync(
        string householdId,
        string expenseId,
        long revision,
        string actorId,
        DateTimeOffset now
    ) =>
        await Live(householdId, expenseId, revision)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(expense => expense.DeletedAt, now)
                        .SetProperty(expense => expense.UpdatedBy, actorId)
                        .SetProperty(expense => expense.Revision, expense => expense.Revision + 1),
                Cancellation
            ) == 1;

    public async Task<bool> AddPaymentAsync(StoredReimbursement payment, long revision)
    {
        var expenseId =
            payment.ExpenseId
            ?? throw new ArgumentException("A payment belongs to an expense.", nameof(payment));
        var updated = await Live(payment.HouseholdId, expenseId, revision)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(expense => expense.Revision, expense => expense.Revision + 1)
                        .SetProperty(expense => expense.UpdatedBy, payment.CreatedBy)
                        .SetProperty(expense => expense.UpdatedAt, payment.CreatedAt),
                Cancellation
            );
        if (updated != 1)
            return false;
        // The unique (expense_id, from_user_id) index backs the already-paid check.
        Context.HouseholdReimbursements.Add(
            new HouseholdReimbursement
            {
                Id = payment.Id,
                HouseholdId = payment.HouseholdId,
                Month = payment.Month,
                FromUserId = payment.FromUserId,
                ToUserId = payment.ToUserId,
                AmountCents = payment.AmountCents,
                ExpenseId = expenseId,
                CreatedBy = payment.CreatedBy,
                CreatedAt = payment.CreatedAt,
            }
        );
        await Context.SaveChangesAsync(Cancellation);
        return true;
    }

    public async Task AddOutboxAsync(IReadOnlyList<StoredOutboxMessage> messages)
    {
        if (messages.Count == 0)
            return;
        Context.PushOutbox.AddRange(
            messages.Select(message => new PushOutboxMessage
            {
                Id = message.Id,
                UserId = message.UserId,
                HouseholdId = message.HouseholdId,
                EventType = message.EventType,
                EntityId = message.EntityId,
                Payload = message.PayloadJson,
                CreatedAt = message.CreatedAt,
                NextAttemptAt = message.CreatedAt,
            })
        );
        await Context.SaveChangesAsync(Cancellation);
    }

    public async Task<IReadOnlyList<StoredReimbursement>> ListReimbursementsAsync(
        string householdId,
        string month
    ) =>
        [
            .. (
                await Context
                    .HouseholdReimbursements.AsNoTracking()
                    .Where(reimbursement =>
                        reimbursement.HouseholdId == householdId && reimbursement.Month == month
                    )
                    .ToListAsync(Cancellation)
            )
                .OrderBy(reimbursement => reimbursement.CreatedAt)
                .ThenBy(reimbursement => reimbursement.Id, StringComparer.Ordinal)
                .Select(reimbursement => new StoredReimbursement(
                    reimbursement.Id,
                    reimbursement.HouseholdId,
                    reimbursement.Month,
                    reimbursement.FromUserId,
                    reimbursement.ToUserId,
                    reimbursement.AmountCents,
                    reimbursement.CreatedBy,
                    reimbursement.CreatedAt,
                    reimbursement.ExpenseId
                )),
        ];

    public async Task AddReimbursementAsync(StoredReimbursement reimbursement)
    {
        if (reimbursement.ExpenseId is not null)
            throw new ArgumentException(
                "A monthly reimbursement has no expense.",
                nameof(reimbursement)
            );
        Context.HouseholdReimbursements.Add(
            new HouseholdReimbursement
            {
                Id = reimbursement.Id,
                HouseholdId = reimbursement.HouseholdId,
                Month = reimbursement.Month,
                FromUserId = reimbursement.FromUserId,
                ToUserId = reimbursement.ToUserId,
                AmountCents = reimbursement.AmountCents,
                CreatedBy = reimbursement.CreatedBy,
                CreatedAt = reimbursement.CreatedAt,
            }
        );
        await Context.SaveChangesAsync(Cancellation);
    }

    public Task<IReadOnlyList<BalanceContribution>> VisibleBalancesAsync(
        string householdId,
        FormerMember viewer
    ) => ContributionsAsync(householdId, viewer);

    public async Task<IReadOnlyList<StoredAuditEvent>> AuditEventsAsync(
        string householdId,
        string? expenseId,
        FormerMember? viewer,
        int? limit
    )
    {
        var viewerId = viewer?.UserId;
        var leftAt = viewer?.LeftAt;
        // Legacy `canSeeExpense` for a former member: a share in the expense while it
        // belongs to this household (deleted expenses included); other events up to
        // the moment they left.
        var events = Context
            .HouseholdAudit.AsNoTracking()
            .Where(entry =>
                entry.HouseholdId == householdId
                && (expenseId == null || entry.ExpenseId == expenseId)
                && (
                    viewerId == null
                    || (
                        entry.ExpenseId != null
                            ? Context.HouseholdSplits.Any(split =>
                                split.ExpenseId == entry.ExpenseId
                                && split.UserId == viewerId
                                && Context.HouseholdExpenses.Any(expense =>
                                    expense.Id == split.ExpenseId
                                    && expense.HouseholdId == householdId
                                )
                            )
                            : entry.CreatedAt <= leftAt
                    )
                )
            )
            .OrderByDescending(entry => entry.CreatedAt)
            .ThenByDescending(entry => entry.SortOrder);
        var rows = await (limit is { } count ? events.Take(count) : events).ToListAsync(
            Cancellation
        );
        return
        [
            .. rows.Select(entry => new StoredAuditEvent(
                entry.Id,
                entry.HouseholdId,
                entry.ActorId,
                entry.Action,
                entry.BeforeJson,
                entry.AfterJson,
                entry.CreatedAt,
                entry.ExpenseId
            )),
        ];
    }

    public async Task IndexExpenseAsync(string expenseId) =>
        await SearchIndexer.SyncExpensesAsync(
            Context,
            Context.HouseholdExpenses.Where(expense => expense.Id == expenseId),
            Cancellation
        );

    // Live expenses by id with their households' names and currencies (search results;
    // the caller has already authorized every id).
    internal async Task<IReadOnlyList<StoredProjectedExpense>> ProjectedAsync(
        IReadOnlyCollection<string> expenseIds
    ) =>
        await WithHouseholdsAsync(
            await LoadAsync(
                Context.HouseholdExpenses.Where(expense =>
                    expense.DeletedAt == null && expenseIds.Contains(expense.Id)
                )
            )
        );

    public async Task<IReadOnlyList<StoredProjectedExpense>> ProjectionAsync(
        string userId,
        DateOnly? from,
        DateOnly? to
    )
    {
        // One row per expense: EXISTS (not a join) on the periods, so a member who
        // left and rejoined is never counted twice.
        var query = Context.HouseholdExpenses.Where(expense =>
            expense.DeletedAt == null
            && Context.HouseholdSplits.Any(split =>
                split.ExpenseId == expense.Id && split.UserId == userId
            )
            && Context.HouseholdMemberPeriods.Any(period =>
                period.HouseholdId == expense.HouseholdId && period.UserId == userId
            )
        );
        if (from is { } first && to is { } last)
            query = query.Where(expense =>
                expense.ExpenseDate >= first && expense.ExpenseDate <= last
            );
        return await WithHouseholdsAsync(Newest(await LoadAsync(query)));
    }

    private async Task<IReadOnlyList<StoredProjectedExpense>> WithHouseholdsAsync(
        List<StoredExpense> loaded
    )
    {
        var householdIds = loaded.Select(expense => expense.HouseholdId).Distinct().ToList();
        var households = await Context
            .Households.AsNoTracking()
            .Where(household => householdIds.Contains(household.Id))
            .ToDictionaryAsync(household => household.Id, StringComparer.Ordinal, Cancellation);
        return
        [
            .. loaded.Select(expense => new StoredProjectedExpense(
                expense,
                households[expense.HouseholdId].Name,
                households[expense.HouseholdId].Currency
            )),
        ];
    }

    public async Task<IReadOnlyList<StoredSharedRule>> ScheduledRulesAsync(
        string userId,
        DateOnly lastDate
    )
    {
        var rows = await Context
            .HouseholdRecurring.AsNoTracking()
            .Where(rule =>
                rule.Active
                && rule.NextDate <= lastDate
                && Context.HouseholdMemberPeriods.Any(period =>
                    period.HouseholdId == rule.HouseholdId
                    && period.UserId == userId
                    && period.LeftAt == null
                )
            )
            .Join(
                Context.Households.Where(household => household.ArchivedAt == null),
                rule => rule.HouseholdId,
                household => household.Id,
                (rule, household) =>
                    new
                    {
                        Rule = rule,
                        household.Name,
                        household.Currency,
                    }
            )
            .ToListAsync(Cancellation);
        var ruleIds = rows.Select(row => row.Rule.Id).ToList();
        var allocations = (
            await Context
                .HouseholdRecurringAllocations.AsNoTracking()
                .Where(allocation => ruleIds.Contains(allocation.RecurringId))
                .ToListAsync(Cancellation)
        ).ToLookup(allocation => allocation.RecurringId, StringComparer.Ordinal);
        return
        [
            .. rows.OrderBy(row => row.Rule.NextDate)
                .ThenBy(row => row.Rule.Id, StringComparer.Ordinal)
                .Select(row => new StoredSharedRule(
                    row.Rule.Id,
                    row.Rule.HouseholdId,
                    row.Name,
                    row.Currency,
                    row.Rule.Title,
                    row.Rule.TotalCents,
                    row.Rule.PayerId,
                    row.Rule.SplitMode,
                    [
                        .. allocations[row.Rule.Id]
                            .OrderBy(allocation => allocation.UserId, StringComparer.Ordinal)
                            .Select(allocation => new SplitAllocation(
                                allocation.UserId,
                                allocation.AmountCents,
                                allocation.PercentBasisPoints
                            )),
                    ],
                    new ExpenseCategory(
                        row.Rule.CategoryName,
                        row.Rule.CategoryIcon,
                        row.Rule.CategoryColor
                    ),
                    row.Rule.Note,
                    row.Rule.AccountId,
                    row.Rule.Frequency,
                    row.Rule.NextDate,
                    row.Rule.AnchorDay
                )),
        ];
    }

    public async Task<IReadOnlySet<DateOnly>> OccurrenceDatesAsync(
        string ruleId,
        DateOnly from,
        DateOnly to
    ) =>
        (
            await Context
                .HouseholdExpenses.AsNoTracking()
                .Where(expense =>
                    expense.RecurringId == ruleId
                    && expense.ExpenseDate >= from
                    && expense.ExpenseDate <= to
                )
                .Select(expense => expense.ExpenseDate)
                .ToListAsync(Cancellation)
        ).ToHashSet();

    public async Task<IReadOnlyList<StoredRule>> ListRulesAsync(string householdId) =>
        [
            .. (
                await LoadRulesAsync(
                    Context.HouseholdRecurring.Where(rule => rule.HouseholdId == householdId)
                )
            )
                .OrderBy(rule => rule.Values.NextDate)
                .ThenBy(rule => rule.Id, StringComparer.Ordinal),
        ];

    public async Task<StoredRule?> FindRuleAsync(string householdId, string ruleId) =>
        (
            await LoadRulesAsync(
                Context.HouseholdRecurring.Where(rule =>
                    rule.Id == ruleId && rule.HouseholdId == householdId
                )
            )
        ).SingleOrDefault();

    public async Task AddRuleAsync(
        string ruleId,
        string householdId,
        RuleRecord record,
        string actorId
    )
    {
        Context.HouseholdRecurring.Add(
            new HouseholdRecurring
            {
                Id = ruleId,
                HouseholdId = householdId,
                Title = record.Title,
                TotalCents = record.TotalCents,
                PayerId = record.PayerId,
                SplitMode = record.SplitMode,
                CategoryName = record.Category.Name,
                CategoryIcon = record.Category.Icon,
                CategoryColor = record.Category.Color,
                Note = record.Note,
                AccountId = record.AccountId,
                ReceiptId = record.ReceiptId,
                Frequency = record.Frequency,
                NextDate = record.NextDate,
                AnchorDay = (short)record.AnchorDay,
                Active = record.Active,
                CreatedBy = actorId,
                Revision = 0,
            }
        );
        AddAllocations(ruleId, record.Allocations);
        await Context.SaveChangesAsync(Cancellation);
    }

    public async Task<bool> UpdateRuleAsync(
        string householdId,
        string ruleId,
        long revision,
        RuleRecord record
    )
    {
        var anchorDay = (short)record.AnchorDay;
        var updated = await Context
            .HouseholdRecurring.Where(rule =>
                rule.Id == ruleId && rule.HouseholdId == householdId && rule.Revision == revision
            )
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(rule => rule.Title, record.Title)
                        .SetProperty(rule => rule.TotalCents, record.TotalCents)
                        .SetProperty(rule => rule.PayerId, record.PayerId)
                        .SetProperty(rule => rule.SplitMode, record.SplitMode)
                        .SetProperty(rule => rule.CategoryName, record.Category.Name)
                        .SetProperty(rule => rule.CategoryIcon, record.Category.Icon)
                        .SetProperty(rule => rule.CategoryColor, record.Category.Color)
                        .SetProperty(rule => rule.Note, record.Note)
                        .SetProperty(rule => rule.AccountId, record.AccountId)
                        .SetProperty(rule => rule.ReceiptId, record.ReceiptId)
                        .SetProperty(rule => rule.Frequency, record.Frequency)
                        .SetProperty(rule => rule.NextDate, record.NextDate)
                        .SetProperty(rule => rule.AnchorDay, anchorDay)
                        .SetProperty(rule => rule.Active, record.Active)
                        .SetProperty(rule => rule.Revision, rule => rule.Revision + 1),
                Cancellation
            );
        if (updated != 1)
            return false;
        await Context
            .HouseholdRecurringAllocations.Where(allocation => allocation.RecurringId == ruleId)
            .ExecuteDeleteAsync(Cancellation);
        AddAllocations(ruleId, record.Allocations);
        await Context.SaveChangesAsync(Cancellation);
        return true;
    }

    // Allocations go with the rule (the only cascading foreign key besides devices).
    public async Task<bool> DeleteRuleAsync(string householdId, string ruleId, long revision) =>
        await Context
            .HouseholdRecurring.Where(rule =>
                rule.Id == ruleId && rule.HouseholdId == householdId && rule.Revision == revision
            )
            .ExecuteDeleteAsync(Cancellation) == 1;

    public async Task<bool> AdvanceRuleAsync(
        string ruleId,
        string leaseToken,
        DateOnly from,
        DateOnly to,
        DateTimeOffset leaseUntil
    ) =>
        await Context
            .HouseholdRecurring.Where(rule =>
                rule.Id == ruleId
                && rule.LeaseToken == leaseToken
                && rule.NextDate == from
                && rule.Active
            )
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(rule => rule.NextDate, to)
                        .SetProperty(rule => rule.Revision, rule => rule.Revision + 1)
                        .SetProperty(rule => rule.LeaseExpiresAt, leaseUntil),
                Cancellation
            ) == 1;

    private void AddAllocations(string ruleId, IReadOnlyList<SplitAllocation> allocations) =>
        Context.HouseholdRecurringAllocations.AddRange(
            allocations.Select(allocation => new HouseholdRecurringAllocation
            {
                RecurringId = ruleId,
                UserId = allocation.UserId,
                AmountCents = allocation.AmountCents,
                PercentBasisPoints = (int?)allocation.PercentBasisPoints,
            })
        );

    // Rules with their allocations (ordered by member id), in two queries.
    private async Task<List<StoredRule>> LoadRulesAsync(IQueryable<HouseholdRecurring> query)
    {
        var rows = await query.AsNoTracking().ToListAsync(Cancellation);
        if (rows.Count == 0)
            return [];
        var ids = rows.Select(row => row.Id).ToList();
        var allocations = (
            await Context
                .HouseholdRecurringAllocations.AsNoTracking()
                .Where(allocation => ids.Contains(allocation.RecurringId))
                .ToListAsync(Cancellation)
        ).ToLookup(allocation => allocation.RecurringId, StringComparer.Ordinal);
        return
        [
            .. rows.Select(row => new StoredRule(
                row.Id,
                row.HouseholdId,
                new RuleRecord(
                    row.Title,
                    row.TotalCents,
                    row.PayerId,
                    row.SplitMode,
                    [
                        .. allocations[row.Id]
                            .OrderBy(allocation => allocation.UserId, StringComparer.Ordinal)
                            .Select(allocation => new SplitAllocation(
                                allocation.UserId,
                                allocation.AmountCents,
                                allocation.PercentBasisPoints
                            )),
                    ],
                    new ExpenseCategory(row.CategoryName, row.CategoryIcon, row.CategoryColor),
                    row.Note,
                    row.AccountId,
                    row.ReceiptId,
                    row.Frequency,
                    row.NextDate,
                    row.AnchorDay,
                    row.Active
                ),
                row.CreatedBy,
                row.Revision,
                row.LeaseToken
            )),
        ];
    }

    // The live expense at `revision`; an update through this query is the
    // compare-and-increment.
    private IQueryable<HouseholdExpense> Live(
        string householdId,
        string expenseId,
        long revision
    ) =>
        Context.HouseholdExpenses.Where(expense =>
            expense.Id == expenseId
            && expense.HouseholdId == householdId
            && expense.Revision == revision
            && expense.DeletedAt == null
        );

    private void AddSplits(string expenseId, IReadOnlyList<SplitShare> splits) =>
        Context.HouseholdSplits.AddRange(
            splits.Select(share => new HouseholdSplit
            {
                ExpenseId = expenseId,
                UserId = share.UserId,
                AmountCents = share.AmountCents,
            })
        );

    // Newest date first, then newest creation, then id (legacy order plus a tie-break).
    private static List<StoredExpense> Newest(IEnumerable<StoredExpense> expenses) =>
        [
            .. expenses
                .OrderByDescending(expense => expense.Date)
                .ThenByDescending(expense => expense.CreatedAt)
                .ThenBy(expense => expense.Id, StringComparer.Ordinal),
        ];

    // Expenses with their splits, payments, closed months and receipts, in five
    // queries whatever the number of expenses.
    private async Task<List<StoredExpense>> LoadAsync(IQueryable<HouseholdExpense> query)
    {
        var rows = await query.AsNoTracking().ToListAsync(Cancellation);
        if (rows.Count == 0)
            return [];
        var ids = rows.Select(row => row.Id).ToList();
        var splits = (
            await Context
                .HouseholdSplits.AsNoTracking()
                .Where(split => ids.Contains(split.ExpenseId))
                .ToListAsync(Cancellation)
        ).ToLookup(split => split.ExpenseId, StringComparer.Ordinal);
        var payments = (
            await Context
                .HouseholdReimbursements.AsNoTracking()
                .Where(payment => payment.ExpenseId != null && ids.Contains(payment.ExpenseId))
                .ToListAsync(Cancellation)
        ).ToLookup(payment => payment.ExpenseId!, StringComparer.Ordinal);
        var householdIds = rows.Select(row => row.HouseholdId).Distinct().ToList();
        var closed = (
            await Context
                .HouseholdReimbursements.AsNoTracking()
                .Where(reimbursement =>
                    reimbursement.ExpenseId == null
                    && householdIds.Contains(reimbursement.HouseholdId)
                )
                .Select(reimbursement => new { reimbursement.HouseholdId, reimbursement.Month })
                .Distinct()
                .ToListAsync(Cancellation)
        )
            .Select(month => (month.HouseholdId, month.Month))
            .ToHashSet();
        var receiptIds = rows.Where(row => row.ReceiptId != null)
            .Select(row => row.ReceiptId!)
            .Distinct()
            .ToList();
        // Filenames are encrypted at rest; only the name is opened, never the file.
        Dictionary<string, StoredReceiptInfo> receipts =
            receiptIds.Count == 0
                ? []
                : (
                    await Context
                        .Receipts.AsNoTracking()
                        .Where(receipt => receiptIds.Contains(receipt.Id))
                        .ToListAsync(Cancellation)
                ).ToDictionary(
                    receipt => receipt.Id,
                    receipt => new StoredReceiptInfo(
                        receipt.Id,
                        files.ReadName(receipt),
                        receipt.Mime
                    ),
                    StringComparer.Ordinal
                );
        return
        [
            .. rows.Select(row => new StoredExpense(
                row.Id,
                row.HouseholdId,
                row.Title,
                row.TotalCents,
                row.ExpenseDate,
                row.PayerId,
                row.SplitMode,
                new ExpenseCategory(row.CategoryName, row.CategoryIcon, row.CategoryColor),
                row.Note,
                row.AccountId,
                row.ReceiptId is { } receiptId ? receipts.GetValueOrDefault(receiptId) : null,
                row.RecurringId,
                row.Revision,
                row.CreatedBy,
                row.CreatedAt,
                row.UpdatedBy,
                row.UpdatedAt,
                [
                    .. splits[row.Id]
                        .OrderBy(split => split.UserId, StringComparer.Ordinal)
                        .Select(split => new SplitShare(split.UserId, split.AmountCents)),
                ],
                [
                    .. payments[row.Id]
                        .OrderBy(payment => payment.CreatedAt)
                        .ThenBy(payment => payment.FromUserId, StringComparer.Ordinal)
                        .Select(payment => new StoredPayment(
                            payment.FromUserId,
                            payment.AmountCents,
                            payment.CreatedAt,
                            payment.CreatedBy
                        )),
                ],
                closed.Contains((row.HouseholdId, Month(row.ExpenseDate)))
            )),
        ];
    }

    private static string Month(DateOnly date) =>
        date.ToString("yyyy-MM", System.Globalization.CultureInfo.InvariantCulture);
}
