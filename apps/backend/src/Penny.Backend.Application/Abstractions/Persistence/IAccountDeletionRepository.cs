namespace Penny.Backend.Application.Abstractions.Persistence;

public interface IAccountDeletionRepository
{
    // Account deletion (MAZ-152), in one transaction: `leaveHouseholds` runs first with the
    // household unit of work (it checks the household rules and closes the person's
    // memberships), then every personal row is deleted and the user row becomes a
    // tombstone (`tombstoneEmail`, no password or profile, `deletedAt`). Shared expenses,
    // splits, payments and audit events stay for the other members. Receipt and raw email
    // files are removed after the commit; a file that can't be removed is left for
    // `receipts-sweep`. False when the user is missing or already deleted.
    Task<bool> DeleteAsync(
        string userId,
        string tombstoneEmail,
        DateTimeOffset deletedAt,
        Func<IHouseholdTransaction, Task> leaveHouseholds,
        CancellationToken cancellationToken
    );
}
