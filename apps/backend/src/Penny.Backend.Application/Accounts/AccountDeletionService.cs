using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Abstractions.Security;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Application.Households;
using Penny.Backend.Domain.Errors;
using Penny.Backend.Domain.Households;

namespace Penny.Backend.Application.Accounts;

// Deleting an account from the apps (MAZ-152). A password account confirms with its
// password; an account that signs in with a provider has none, and its session is the
// confirmation. Deleting leaves every household the person is in, under the same rules as
// leaving one: they must be settled in every month, and a creator can't leave while other
// members remain. Their shared expenses, splits and payments stay, so the other members'
// balances don't change, and the household shows them as a former member. Everything
// else is deleted: the ledger, receipts, emailed receipts and the receipt address,
// sessions on every device, push devices, pending email and push messages, the picture,
// the name and the email.
public sealed class AccountDeletionService(
    IAccountRepository accounts,
    IAccountDeletionRepository deletion,
    IPasswordHasher passwords,
    TimeProvider clock
)
{
    public const string WrongPassword = "Your password is incorrect.";

    // The email a deleted account keeps, so the unique email index and the contract's
    // `email` field still hold. `.invalid` never resolves (RFC 2606).
    public static string TombstoneEmail(string userId) => $"deleted-{userId}@deleted.invalid";

    public static string CreatorWithMembers(string household) =>
        $"You created {household}, and other people are still in it. Remove them or archive {household} before you delete your account.";

    public static string Unsettled(string household) =>
        $"Settle every monthly balance in {household} before you delete your account.";

    public async Task DeleteAsync(
        AuthenticatedSession session,
        string? password,
        CancellationToken cancellationToken
    )
    {
        var user = await accounts.FindByIdAsync(session.UserId, cancellationToken)
            ?? throw new BackendFailure(
                FailureKind.Unauthorized,
                ErrorCodes.AuthSignInRequired,
                AuthService.SignInRequired
            );
        // Always verify a password account, so a missing password costs the same as a
        // wrong one. OIDC accounts have an empty hash and no password to ask for.
        if (
            user.Password.Length > 0
            && passwords.Verify(user.Password, password ?? "") == PasswordCheck.Failed
        )
            throw new BackendFailure(
                FailureKind.Invalid,
                ErrorCodes.AccountWrongPassword,
                WrongPassword
            );
        var now = MembershipDates.Truncate(clock.GetUtcNow());
        var deleted = await deletion.DeleteAsync(
            user.Id,
            TombstoneEmail(user.Id),
            now,
            store => LeaveHouseholdsAsync(store, user.Id, now),
            cancellationToken
        );
        if (!deleted)
            throw new BackendFailure(
                FailureKind.Unauthorized,
                ErrorCodes.AuthSignInRequired,
                AuthService.SignInRequired
            );
    }

    // Households are locked in id order, so two deletions never wait on each other in a
    // cycle. An archived household takes no writes and was settled when it was archived,
    // so its period just closes.
    private static async Task LeaveHouseholdsAsync(
        IHouseholdTransaction store,
        string userId,
        DateTimeOffset now
    )
    {
        foreach (var household in await store.CurrentMembershipsAsync(userId))
        {
            // A household archived since the list was read fails the lock and just closes.
            if (
                household.ArchivedAt is null
                && await store.LockAsync(household.Id)
                && await store.FindAsync(household.Id, includeArchived: false) is { } current
            )
            {
                if (
                    string.Equals(current.CreatorId, userId, StringComparison.Ordinal)
                    && current.MemberCount > 1
                )
                    throw new BackendFailure(
                        FailureKind.Conflict,
                        ErrorCodes.AccountCreatorWithMembers,
                        CreatorWithMembers(current.Name)
                    );
                if (!HouseholdSettlement.IsSettled(await store.BalancesAsync(current.Id), userId))
                    throw new BackendFailure(
                        FailureKind.Conflict,
                        ErrorCodes.AccountUnsettled,
                        Unsettled(current.Name)
                    );
            }
            await store.ClosePeriodAsync(household.Id, userId, now);
            await HouseholdService.AuditAsync(
                store,
                household.Id,
                userId,
                "member.left",
                new { userId },
                null,
                now
            );
        }
    }
}
