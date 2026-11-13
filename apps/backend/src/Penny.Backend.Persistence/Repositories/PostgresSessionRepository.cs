using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Repositories;

public sealed class PostgresSessionRepository(NpgsqlDataSource source) : ISessionRepository
{
    public async Task CreateAsync(
        string tokenHash,
        string userId,
        DateTimeOffset expiresAt,
        DateTimeOffset now,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await using var transaction = await context.Database.BeginTransactionAsync(
            cancellationToken
        );
        // Push devices registered to purged sessions cascade in the database.
        await context
            .Sessions.Where(session => session.ExpiresAt < now)
            .ExecuteDeleteAsync(cancellationToken);
        context.Sessions.Add(
            new Session
            {
                TokenHash = tokenHash,
                UserId = userId,
                ExpiresAt = expiresAt,
            }
        );
        await context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<string?> FindUserAsync(
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

    public async Task RemoveAsync(string tokenHash, CancellationToken cancellationToken)
    {
        await using var context = PennyDbContext.Create(source);
        await context
            .Sessions.Where(session => session.TokenHash == tokenHash)
            .ExecuteDeleteAsync(cancellationToken);
    }
}
