using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Households;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Repositories;

// Row locks are taken with EF `ExecuteUpdate` statements that rewrite a column with
// its own value (`UPDATE ... SET name = name WHERE ...`): PostgreSQL holds the row's
// FOR NO KEY UPDATE lock until commit, exactly like the ledger compare-and-increment,
// without raw SQL. Such locks conflict with each other and with ledger saves, but not
// with foreign-key checks of rows that merely reference the household.
internal sealed class PostgresHouseholdTransaction(
    PennyDbContext context,
    CancellationToken cancellationToken
) : IHouseholdTransaction
{
    public async Task<IReadOnlyList<StoredHousehold>> ListAsync(string userId) =>
        await Project(
                context
                    .Households.AsNoTracking()
                    .Where(household =>
                        household.ArchivedAt == null
                        && context.HouseholdMemberPeriods.Any(period =>
                            period.HouseholdId == household.Id && period.UserId == userId
                        )
                    )
                    .OrderByDescending(household => household.CreatedAt)
                    .ThenBy(household => household.Id)
            )
            .ToListAsync(cancellationToken);

    public Task<StoredHousehold?> FindAsync(string householdId, bool includeArchived) =>
        Project(
                context
                    .Households.AsNoTracking()
                    .Where(household =>
                        household.Id == householdId
                        && (includeArchived || household.ArchivedAt == null)
                    )
            )
            .SingleOrDefaultAsync(cancellationToken);

    public async Task<bool> LockAsync(string householdId) =>
        await context
            .Households.Where(household =>
                household.Id == householdId && household.ArchivedAt == null
            )
            .ExecuteUpdateAsync(
                set => set.SetProperty(household => household.Name, household => household.Name),
                cancellationToken
            ) == 1;

    public async Task<string?> LockLedgerCurrencyAsync(string userId)
    {
        var locked = await context
            .Ledgers.Where(ledger => ledger.UserId == userId)
            .ExecuteUpdateAsync(
                set => set.SetProperty(ledger => ledger.Currency, ledger => ledger.Currency),
                cancellationToken
            );
        if (locked != 1)
            return null;
        return await context
            .Ledgers.AsNoTracking()
            .Where(ledger => ledger.UserId == userId)
            .Select(ledger => ledger.Currency)
            .SingleAsync(cancellationToken);
    }

    public async Task<StoredMember?> MembershipAsync(string householdId, string userId)
    {
        var periods = await Periods(householdId, userId).ToListAsync(cancellationToken);
        return periods.Count == 0 ? null : Latest(periods);
    }

    public async Task<IReadOnlyList<StoredMember>> MembersAsync(string householdId) =>
        [
            .. (await Periods(householdId, null).ToListAsync(cancellationToken))
                .GroupBy(period => period.UserId, StringComparer.Ordinal)
                .Select(Latest)
                .OrderBy(member => member.JoinedAt)
                .ThenBy(member => member.UserId, StringComparer.Ordinal),
        ];

    public async Task<IReadOnlyList<BalanceContribution>> BalancesAsync(string householdId)
    {
        var expenses = context.HouseholdExpenses.Where(expense =>
            expense.HouseholdId == householdId && expense.DeletedAt == null
        );
        var paid = await expenses
            .GroupBy(expense => new
            {
                expense.ExpenseDate.Year,
                expense.ExpenseDate.Month,
                expense.PayerId,
            })
            .Select(group => new
            {
                group.Key.Year,
                group.Key.Month,
                UserId = group.Key.PayerId,
                Cents = group.Sum(expense => expense.TotalCents),
            })
            .ToListAsync(cancellationToken);
        var shares = await context
            .HouseholdSplits.Join(
                expenses,
                split => split.ExpenseId,
                expense => expense.Id,
                (split, expense) =>
                    new
                    {
                        expense.ExpenseDate.Year,
                        expense.ExpenseDate.Month,
                        split.UserId,
                        split.AmountCents,
                    }
            )
            .GroupBy(share => new
            {
                share.Year,
                share.Month,
                share.UserId,
            })
            .Select(group => new
            {
                group.Key.Year,
                group.Key.Month,
                group.Key.UserId,
                Cents = group.Sum(share => share.AmountCents),
            })
            .ToListAsync(cancellationToken);
        // Both monthly reimbursements and individual expense payments count.
        var reimbursements = context.HouseholdReimbursements.Where(reimbursement =>
            reimbursement.HouseholdId == householdId
        );
        var sent = await reimbursements
            .GroupBy(reimbursement => new { reimbursement.Month, reimbursement.FromUserId })
            .Select(group => new
            {
                group.Key.Month,
                UserId = group.Key.FromUserId,
                Cents = group.Sum(reimbursement => reimbursement.AmountCents),
            })
            .ToListAsync(cancellationToken);
        var received = await reimbursements
            .GroupBy(reimbursement => new { reimbursement.Month, reimbursement.ToUserId })
            .Select(group => new
            {
                group.Key.Month,
                UserId = group.Key.ToUserId,
                Cents = group.Sum(reimbursement => reimbursement.AmountCents),
            })
            .ToListAsync(cancellationToken);
        return
        [
            .. paid.Select(row => new BalanceContribution(
                Month(row.Year, row.Month),
                row.UserId,
                row.Cents
            )),
            .. shares.Select(row => new BalanceContribution(
                Month(row.Year, row.Month),
                row.UserId,
                -row.Cents
            )),
            .. sent.Select(row => new BalanceContribution(row.Month, row.UserId, row.Cents)),
            .. received.Select(row => new BalanceContribution(row.Month, row.UserId, -row.Cents)),
        ];
    }

    public Task<StoredInvite?> FindInviteAsync(string codeHash) =>
        context
            .HouseholdInvites.AsNoTracking()
            .Where(invite => invite.CodeHash == codeHash)
            .Select(invite => new StoredInvite(invite.HouseholdId, invite.ExpiresAt))
            .SingleOrDefaultAsync(cancellationToken);

    public async Task ReplaceInviteAsync(
        string householdId,
        string codeHash,
        DateTimeOffset expiresAt
    )
    {
        await DeleteInvitesAsync(householdId);
        context.HouseholdInvites.Add(
            new HouseholdInvite
            {
                CodeHash = codeHash,
                HouseholdId = householdId,
                ExpiresAt = expiresAt,
            }
        );
        await context.SaveChangesAsync(cancellationToken);
    }

    public Task DeleteInvitesAsync(string householdId) =>
        context
            .HouseholdInvites.Where(invite => invite.HouseholdId == householdId)
            .ExecuteDeleteAsync(cancellationToken);

    public async Task AddHouseholdAsync(StoredHousehold household)
    {
        context.Households.Add(
            new Household
            {
                Id = household.Id,
                Name = household.Name,
                Currency = household.Currency,
                CreatorId = household.CreatorId,
                CreatedAt = household.CreatedAt,
                ArchivedAt = household.ArchivedAt,
                TripStart = household.Trip?.Start,
                TripEnd = household.Trip?.End,
            }
        );
        await context.SaveChangesAsync(cancellationToken);
    }

    public Task RenameAsync(string householdId, string name) =>
        context
            .Households.Where(household => household.Id == householdId)
            .ExecuteUpdateAsync(
                set => set.SetProperty(household => household.Name, name),
                cancellationToken
            );

    public Task UpdateTripAsync(string householdId, string name, TripDates dates) =>
        context
            .Households.Where(household => household.Id == householdId)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(household => household.Name, name)
                        .SetProperty(household => household.TripStart, dates.Start)
                        .SetProperty(household => household.TripEnd, dates.End),
                cancellationToken
            );

    public Task ArchiveAsync(string householdId, DateTimeOffset archivedAt) =>
        context
            .Households.Where(household => household.Id == householdId)
            .ExecuteUpdateAsync(
                set => set.SetProperty(household => household.ArchivedAt, archivedAt),
                cancellationToken
            );

    public async Task OpenPeriodAsync(
        string periodId,
        string householdId,
        string userId,
        DateTimeOffset joinedAt,
        DateOnly? joinedOn
    )
    {
        // The partial unique index (one open period per member) backs the
        // already-a-member check if a writer ever skipped the household lock.
        context.HouseholdMemberPeriods.Add(
            new HouseholdMemberPeriod
            {
                Id = periodId,
                HouseholdId = householdId,
                UserId = userId,
                JoinedAt = joinedAt,
                JoinedOn = joinedOn,
            }
        );
        await context.SaveChangesAsync(cancellationToken);
    }

    // Instances' clocks may differ slightly; a period never ends before it began.
    public Task ClosePeriodAsync(string householdId, string userId, DateTimeOffset leftAt) =>
        context
            .HouseholdMemberPeriods.Where(period =>
                period.HouseholdId == householdId
                && period.UserId == userId
                && period.LeftAt == null
            )
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(
                        period => period.LeftAt,
                        period =>
                            (DateTimeOffset?)(period.JoinedAt > leftAt ? period.JoinedAt : leftAt)
                    ),
                cancellationToken
            );

    public async Task AuditAsync(StoredAuditEvent audit)
    {
        context.HouseholdAudit.Add(
            new HouseholdAuditEntry
            {
                Id = audit.Id,
                HouseholdId = audit.HouseholdId,
                ActorId = audit.ActorId,
                Action = audit.Action,
                BeforeJson = audit.BeforeJson,
                AfterJson = audit.AfterJson,
                CreatedAt = audit.CreatedAt,
            }
        );
        await context.SaveChangesAsync(cancellationToken);
    }

    private IQueryable<StoredHousehold> Project(IQueryable<Household> households) =>
        households.Select(household => new StoredHousehold(
            household.Id,
            household.Name,
            household.Currency,
            household.CreatorId,
            household.CreatedAt,
            household.ArchivedAt,
            household.TripStart == null || household.TripEnd == null
                ? null
                : new TripDates(household.TripStart.Value, household.TripEnd.Value),
            context.HouseholdMemberPeriods.Count(period =>
                period.HouseholdId == household.Id && period.LeftAt == null
            )
        ));

    // Periods of one household, optionally of one user, with the member's email.
    private IQueryable<StoredMember> Periods(string householdId, string? userId) =>
        context
            .HouseholdMemberPeriods.AsNoTracking()
            .Where(period =>
                period.HouseholdId == householdId && (userId == null || period.UserId == userId)
            )
            .Join(
                context.Users,
                period => period.UserId,
                user => user.Id,
                (period, user) =>
                    new StoredMember(
                        period.UserId,
                        user.Email,
                        period.JoinedAt,
                        period.JoinedOn,
                        period.LeftAt
                    )
            );

    // The legacy `household_members` row: the open period, otherwise the one that
    // ended last.
    private static StoredMember Latest(IEnumerable<StoredMember> periods) =>
        periods
            .OrderBy(period => period.IsCurrent ? 0 : 1)
            .ThenByDescending(period => period.LeftAt)
            .ThenByDescending(period => period.JoinedAt)
            .First();

    private static string Month(int year, int month) =>
        string.Create(CultureInfo.InvariantCulture, $"{year:D4}-{month:D2}");
}
