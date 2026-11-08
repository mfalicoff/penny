namespace Penny.Backend.Application.Abstractions.Persistence;

public interface IAccountRepository
{
    Task<StoredUser?> FindByEmailAsync(string email, CancellationToken cancellationToken);
    Task<StoredUser?> FindByIdentityAsync(
        string issuer,
        string subject,
        CancellationToken cancellationToken
    );
    Task<string?> FindSessionUserAsync(
        string tokenHash,
        DateTimeOffset now,
        CancellationToken cancellationToken
    );
}
