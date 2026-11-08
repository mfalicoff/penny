using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Persistence.Schema;

namespace Penny.Backend.Persistence.Repositories;

public sealed class PostgresAccountRepository(NpgsqlDataSource source) : IAccountRepository
{
    public async Task<StoredUser?> FindByEmailAsync(
        string email,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        return await context
            .Users.AsNoTracking()
            .Where(user => user.Email == email)
            .Select(user => new StoredUser(user.Id, user.Email, user.Password, user.Salt))
            .SingleOrDefaultAsync(cancellationToken);
    }

    public async Task<StoredUser?> FindByIdentityAsync(
        string issuer,
        string subject,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        return await context
            .OidcIdentities.AsNoTracking()
            .Where(identity => identity.Issuer == issuer && identity.Subject == subject)
            .Join(
                context.Users,
                identity => identity.UserId,
                user => user.Id,
                (_, user) => new StoredUser(user.Id, user.Email, user.Password, user.Salt)
            )
            .SingleOrDefaultAsync(cancellationToken);
    }

    public async Task<string?> FindSessionUserAsync(
        string tokenHash,
        DateTimeOffset now,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        return await context
            .Sessions.AsNoTracking()
            .Where(session => session.TokenHash == tokenHash && session.ExpiresAt > now)
            .Select(session => session.UserId)
            .SingleOrDefaultAsync(cancellationToken);
    }
}
