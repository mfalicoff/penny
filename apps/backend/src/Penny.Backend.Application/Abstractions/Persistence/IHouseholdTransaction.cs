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

    // Households the user has ever joined, archived ones too, oldest first (the full
    // export, MAZ-152).
    Task<IReadOnlyList<StoredHousehold>> JoinedAsync(string userId);

    // Households, archived or not, in which the user is a current member, ordered by id
    // (the order account deletion locks them in, MAZ-152).
    Task<IReadOnlyList<StoredHousehold>> CurrentMembershipsAsync(string userId);

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

    // The household's shared code, or else an emailed invitation's unused, unrevoked code.
    Task<StoredInvite?> FindInviteAsync(string codeHash);

    // Deletes the household's earlier invites and stores this one.
    Task ReplaceInviteAsync(string householdId, string codeHash, DateTimeOffset expiresAt);

    // Archive: deletes the shared code and revokes every emailed invitation, finishing
    // their unsent emails.
    Task DeleteInvitesAsync(string householdId, DateTimeOffset now);

    // Emailed invitations (MAZ-124). Revoked ones are left out of the list.
    Task<IReadOnlyList<StoredEmailInvite>> EmailInvitesAsync(string householdId);

    Task<StoredEmailInvite?> FindEmailInviteAsync(string inviteId);

    // Creates the household's invitation for `email`, or requests it again: clears its
    // failed, joined and revoked marks and records `now` as the latest request. The
    // earlier code keeps working until the new email issues its own.
    Task<StoredEmailInvite> RequestEmailInviteAsync(
        string inviteId,
        string householdId,
        string invitedBy,
        string email,
        DateTimeOffset now
    );

    // Stores the hash of the code an invitation email is about to carry.
    Task IssueEmailInviteCodeAsync(string inviteId, string codeHash, DateTimeOffset expiresAt);

    // Clears the code (it joins once) and records the join.
    Task MarkEmailInviteJoinedAsync(string inviteId, DateTimeOffset joinedAt);

    // Clears the code, marks the invitation revoked and finishes its unsent emails.
    Task RevokeEmailInviteAsync(string inviteId, DateTimeOffset now);

    // Messages created since `since` for the account and for the recipient, after locking
    // the account's user row (lock order: household, then users).
    Task<(int Account, int Recipient)> CountRecentMailAsync(
        string accountId,
        string recipientHash,
        DateTimeOffset since
    );

    // Queues an invitation email; earlier unsent emails for the invitation finish as
    // superseded, so one request sends one email.
    Task EnqueueInviteMailAsync(
        string messageId,
        string inviteId,
        string accountId,
        string recipientHash,
        string locale,
        DateTimeOffset now
    );

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
