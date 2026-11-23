using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Mail;
using Penny.Backend.Domain.Households;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Repositories;

// Row locks are taken with EF `ExecuteUpdate` statements that rewrite a column with
// its own value (`UPDATE ... SET name = name WHERE ...`): PostgreSQL holds the row's
// FOR NO KEY UPDATE lock until commit, exactly like the ledger compare-and-increment,
// without raw SQL. Such locks conflict with each other and with ledger saves, but not
// with foreign-key checks of rows that merely reference the household.
internal class PostgresHouseholdTransaction(
    PennyDbContext context,
    CancellationToken cancellationToken
) : IHouseholdTransaction
{
    // For the shared-expense unit of work, which extends this one.
    protected PennyDbContext Context => context;

    protected CancellationToken Cancellation => cancellationToken;

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
        if (!await LockLedgerAsync(userId))
            return null;
        return await context
            .Ledgers.AsNoTracking()
            .Where(ledger => ledger.UserId == userId)
            .Select(ledger => ledger.Currency)
            .SingleAsync(cancellationToken);
    }

    // Locks the user's `ledgers` row until the unit ends; false when there is none.
    protected async Task<bool> LockLedgerAsync(string userId) =>
        await context
            .Ledgers.Where(ledger => ledger.UserId == userId)
            .ExecuteUpdateAsync(
                set => set.SetProperty(ledger => ledger.Currency, ledger => ledger.Currency),
                cancellationToken
            ) == 1;

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

    public Task<IReadOnlyList<BalanceContribution>> BalancesAsync(string householdId) =>
        ContributionsAsync(householdId, null);

    // Signed per-month amounts. With a former member, only what they can see: expenses
    // in which they have a share, and reimbursements recorded by the time they left or
    // involving them (the recap of a departed member).
    protected async Task<IReadOnlyList<BalanceContribution>> ContributionsAsync(
        string householdId,
        FormerMember? viewer
    )
    {
        var viewerId = viewer?.UserId;
        var leftAt = viewer?.LeftAt;
        var expenses = context.HouseholdExpenses.Where(expense =>
            expense.HouseholdId == householdId
            && expense.DeletedAt == null
            && (
                viewerId == null
                || context.HouseholdSplits.Any(split =>
                    split.ExpenseId == expense.Id && split.UserId == viewerId
                )
            )
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
            && (
                viewerId == null
                || reimbursement.CreatedAt <= leftAt
                || reimbursement.FromUserId == viewerId
                || reimbursement.ToUserId == viewerId
            )
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

    public async Task<StoredInvite?> FindInviteAsync(string codeHash) =>
        await context
            .HouseholdInvites.AsNoTracking()
            .Where(invite => invite.CodeHash == codeHash)
            .Select(invite => new StoredInvite(invite.HouseholdId, invite.ExpiresAt, null))
            .SingleOrDefaultAsync(cancellationToken)
        ?? await context
            .HouseholdEmailInvites.AsNoTracking()
            .Where(invite =>
                invite.CodeHash == codeHash
                && invite.JoinedAt == null
                && invite.RevokedAt == null
            )
            .Select(invite => new StoredInvite(
                invite.HouseholdId,
                invite.ExpiresAt!.Value,
                invite.Id
            ))
            .SingleOrDefaultAsync(cancellationToken);

    public async Task ReplaceInviteAsync(
        string householdId,
        string codeHash,
        DateTimeOffset expiresAt
    )
    {
        // Only the shared code: emailed invitations keep their own codes.
        await context
            .HouseholdInvites.Where(invite => invite.HouseholdId == householdId)
            .ExecuteDeleteAsync(cancellationToken);
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

    public async Task DeleteInvitesAsync(string householdId, DateTimeOffset now)
    {
        await context
            .HouseholdInvites.Where(invite => invite.HouseholdId == householdId)
            .ExecuteDeleteAsync(cancellationToken);
        var emailed = context.HouseholdEmailInvites.Where(invite =>
            invite.HouseholdId == householdId && invite.RevokedAt == null
        );
        await FinishInviteMailAsync(emailed.Select(invite => invite.Id), now, "revoked");
        await emailed.ExecuteUpdateAsync(
            set =>
                set.SetProperty(invite => invite.RevokedAt, now)
                    .SetProperty(invite => invite.CodeHash, (string?)null)
                    .SetProperty(invite => invite.ExpiresAt, (DateTimeOffset?)null),
            cancellationToken
        );
    }

    public async Task<IReadOnlyList<StoredEmailInvite>> EmailInvitesAsync(string householdId) =>
        await ProjectEmailInvites(
                context
                    .HouseholdEmailInvites.AsNoTracking()
                    .Where(invite => invite.HouseholdId == householdId && invite.RevokedAt == null)
                    .OrderByDescending(invite => invite.RequestedAt)
                    .ThenBy(invite => invite.Id)
            )
            .ToListAsync(cancellationToken);

    public Task<StoredEmailInvite?> FindEmailInviteAsync(string inviteId) =>
        ProjectEmailInvites(
                context.HouseholdEmailInvites.AsNoTracking().Where(invite => invite.Id == inviteId)
            )
            .SingleOrDefaultAsync(cancellationToken);

    public async Task<StoredEmailInvite> RequestEmailInviteAsync(
        string inviteId,
        string householdId,
        string invitedBy,
        string email,
        DateTimeOffset now
    )
    {
        // The household lock is held, so no concurrent request inserts the same address.
        var stored = await context.HouseholdEmailInvites.SingleOrDefaultAsync(
            invite => invite.HouseholdId == householdId && invite.Email == email,
            cancellationToken
        );
        if (stored is null)
        {
            stored = new HouseholdEmailInvite
            {
                Id = inviteId,
                HouseholdId = householdId,
                InvitedBy = invitedBy,
                Email = email,
                CreatedAt = now,
                RequestedAt = now,
            };
            context.HouseholdEmailInvites.Add(stored);
        }
        else
        {
            if (stored.RevokedAt is not null || stored.JoinedAt is not null)
            {
                // A fresh invitation: the old code is gone and the history starts again.
                stored.CreatedAt = now;
                stored.SentAt = null;
                stored.CodeHash = null;
                stored.ExpiresAt = null;
            }
            stored.InvitedBy = invitedBy;
            stored.RequestedAt = now;
            stored.FailedAt = null;
            stored.JoinedAt = null;
            stored.RevokedAt = null;
        }
        await context.SaveChangesAsync(cancellationToken);
        return ToStored(stored);
    }

    public Task IssueEmailInviteCodeAsync(
        string inviteId,
        string codeHash,
        DateTimeOffset expiresAt
    ) =>
        context
            .HouseholdEmailInvites.Where(invite => invite.Id == inviteId)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(invite => invite.CodeHash, codeHash)
                        .SetProperty(invite => invite.ExpiresAt, expiresAt),
                cancellationToken
            );

    public Task MarkEmailInviteJoinedAsync(string inviteId, DateTimeOffset joinedAt) =>
        context
            .HouseholdEmailInvites.Where(invite => invite.Id == inviteId)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(invite => invite.JoinedAt, joinedAt)
                        .SetProperty(invite => invite.CodeHash, (string?)null)
                        .SetProperty(invite => invite.ExpiresAt, (DateTimeOffset?)null),
                cancellationToken
            );

    public async Task RevokeEmailInviteAsync(string inviteId, DateTimeOffset now)
    {
        await FinishInviteMailAsync(
            context.HouseholdEmailInvites.Where(invite => invite.Id == inviteId).Select(invite => invite.Id),
            now,
            "revoked"
        );
        await context
            .HouseholdEmailInvites.Where(invite => invite.Id == inviteId)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(invite => invite.RevokedAt, now)
                        .SetProperty(invite => invite.CodeHash, (string?)null)
                        .SetProperty(invite => invite.ExpiresAt, (DateTimeOffset?)null),
                cancellationToken
            );
    }

    public async Task<(int Account, int Recipient)> CountRecentMailAsync(
        string accountId,
        string recipientHash,
        DateTimeOffset since
    )
    {
        await context
            .Users.Where(user => user.Id == accountId)
            .ExecuteUpdateAsync(
                set => set.SetProperty(user => user.Email, user => user.Email),
                cancellationToken
            );
        var account = await context.MailOutbox.CountAsync(
            message => message.AccountId == accountId && message.CreatedAt > since,
            cancellationToken
        );
        var recipient = await context.MailOutbox.CountAsync(
            message => message.RecipientHash == recipientHash && message.CreatedAt > since,
            cancellationToken
        );
        return (account, recipient);
    }

    public async Task EnqueueInviteMailAsync(
        string messageId,
        string inviteId,
        string accountId,
        string recipientHash,
        string locale,
        DateTimeOffset now
    )
    {
        await FinishInviteMailAsync(
            context.HouseholdEmailInvites.Where(invite => invite.Id == inviteId).Select(invite => invite.Id),
            now,
            "superseded"
        );
        context.MailOutbox.Add(
            new MailOutboxMessage
            {
                Id = messageId,
                Kind = MailKinds.HouseholdInvite,
                EmailInviteId = inviteId,
                AccountId = accountId,
                RecipientHash = recipientHash,
                Locale = locale,
                CreatedAt = now,
                NextAttemptAt = now,
            }
        );
        await context.SaveChangesAsync(cancellationToken);
    }

    // Unsent, unleased-or-leased emails of these invitations end without sending. A
    // runner holding one records its outcome afterwards; a message that already left
    // stays a fact.
    private Task<int> FinishInviteMailAsync(
        IQueryable<string> inviteIds,
        DateTimeOffset now,
        string reason
    ) =>
        context
            .MailOutbox.Where(message =>
                message.FinishedAt == null
                && message.EmailInviteId != null
                && inviteIds.Contains(message.EmailInviteId)
            )
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(message => message.FinishedAt, now)
                        .SetProperty(message => message.LastError, reason),
                cancellationToken
            );

    private static IQueryable<StoredEmailInvite> ProjectEmailInvites(
        IQueryable<HouseholdEmailInvite> invites
    ) =>
        invites.Select(invite => new StoredEmailInvite(
            invite.Id,
            invite.HouseholdId,
            invite.InvitedBy,
            invite.Email,
            invite.CreatedAt,
            invite.RequestedAt,
            invite.SentAt,
            invite.ExpiresAt,
            invite.FailedAt,
            invite.JoinedAt,
            invite.RevokedAt
        ));

    private static StoredEmailInvite ToStored(HouseholdEmailInvite invite) =>
        new(
            invite.Id,
            invite.HouseholdId,
            invite.InvitedBy,
            invite.Email,
            invite.CreatedAt,
            invite.RequestedAt,
            invite.SentAt,
            invite.ExpiresAt,
            invite.FailedAt,
            invite.JoinedAt,
            invite.RevokedAt
        );

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
                ExpenseId = audit.ExpenseId,
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

    // Periods of one household, optionally of one user, with the member's email and profile.
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
                        period.LeftAt,
                        user.DisplayName,
                        user.AvatarVersion
                    )
            );

    // A member's latest period: the open one, otherwise the one that ended last.
    private static StoredMember Latest(IEnumerable<StoredMember> periods) =>
        periods
            .OrderBy(period => period.IsCurrent ? 0 : 1)
            .ThenByDescending(period => period.LeftAt)
            .ThenByDescending(period => period.JoinedAt)
            .First();

    private static string Month(int year, int month) =>
        string.Create(CultureInfo.InvariantCulture, $"{year:D4}-{month:D2}");
}
