using Penny.Backend.Domain.Households;

namespace Penny.Backend.Application.Abstractions.Persistence;

// Operations inside one household unit of work (cancellation is bound to the unit).
// Lock order for writers: the household row, then users' `ledgers` rows, then
// entities (invites, periods). Every membership writer locks the household first, so
// writers of one household serialize and cannot deadlock with each other.
public interface IHouseholdTransaction
{
    // Households the user has ever joined (current or former member), not archived,
    // newest first.
    Task<IReadOnlyList<StoredHousehold>> ListAsync(string userId);

    Task<StoredHousehold?> FindAsync(string householdId, bool includeArchived);

    // Locks an unarchived household's row until the unit ends. False when the
    // household does not exist or is archived.
    Task<bool> LockAsync(string householdId);

    // Locks the user's `ledgers` row (the row PUT /api/ledger compare-and-increments)
    // and returns its currency, so ledger saves and membership changes that validate
    // currency serialize. Null when the user has no ledger.
    Task<string?> LockLedgerCurrencyAsync(string userId);

    // The user's latest period in the household, or null if they never joined.
    Task<StoredMember?> MembershipAsync(string householdId, string userId);

    // Every member's latest period, ordered by join instant, then user id.
    Task<IReadOnlyList<StoredMember>> MembersAsync(string householdId);

    // Signed per-month amounts from live expenses, splits and reimbursements.
    Task<IReadOnlyList<BalanceContribution>> BalancesAsync(string householdId);

    Task<StoredInvite?> FindInviteAsync(string codeHash);

    // Deletes the household's earlier invites and stores this one.
    Task ReplaceInviteAsync(string householdId, string codeHash, DateTimeOffset expiresAt);

    Task DeleteInvitesAsync(string householdId);

    Task AddHouseholdAsync(StoredHousehold household);

    Task RenameAsync(string householdId, string name);

    Task UpdateTripAsync(string householdId, string name, TripDates dates);

    Task ArchiveAsync(string householdId, DateTimeOffset archivedAt);

    Task OpenPeriodAsync(
        string periodId,
        string householdId,
        string userId,
        DateTimeOffset joinedAt,
        DateOnly? joinedOn
    );

    // Closes the user's open period; never before it began, whatever the clock says.
    Task ClosePeriodAsync(string householdId, string userId, DateTimeOffset leftAt);

    Task AuditAsync(StoredAuditEvent audit);
}
