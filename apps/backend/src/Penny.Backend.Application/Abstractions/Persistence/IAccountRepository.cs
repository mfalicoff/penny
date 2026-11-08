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

    // Replaces the hash only if it is still `currentHash`, so a concurrent change wins.
    Task UpdatePasswordAsync(
        string userId,
        string currentHash,
        string newHash,
        CancellationToken cancellationToken
    );

    // Creates the user and its initial ledger in one transaction. False means the
    // email already exists (including a concurrent registration that committed first);
    // any other failure rolls back both rows and propagates.
    Task<bool> TryCreateAsync(
        StoredUser user,
        StoredLedger ledger,
        CancellationToken cancellationToken
    );

    // Creates the user, its (issuer, subject) identity and its initial ledger in one
    // transaction. False means the email or the identity already exists (including a
    // concurrent sign-in that committed first); any other failure rolls back every row.
    Task<bool> TryCreateOidcAsync(
        StoredUser user,
        string issuer,
        string subject,
        StoredLedger ledger,
        CancellationToken cancellationToken
    );
}
