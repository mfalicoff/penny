namespace Penny.Backend.Application.Abstractions.Persistence;

public interface IAccountRepository
{
    Task<StoredUser?> FindByEmailAsync(string email, CancellationToken cancellationToken);
    Task<StoredUser?> FindByIdentityAsync(
        string issuer,
        string subject,
        CancellationToken cancellationToken
    );
    Task<string?> FindEmailAsync(string userId, CancellationToken cancellationToken);

    // Creates the user and its initial ledger in one transaction. False means the
    // email already exists (including a concurrent registration that committed first);
    // any other failure rolls back both rows and propagates.
    Task<bool> TryCreateAsync(
        StoredUser user,
        StoredLedger ledger,
        CancellationToken cancellationToken
    );
}
