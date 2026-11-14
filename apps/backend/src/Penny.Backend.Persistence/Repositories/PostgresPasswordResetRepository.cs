using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Repositories;

public sealed class PostgresPasswordResetRepository(NpgsqlDataSource source)
    : IPasswordResetRepository
{
    public async Task ReplaceAsync(
        string userId,
        string tokenHash,
        DateTimeOffset expiresAt,
        DateTimeOffset now,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await using var transaction = await context.Database.BeginTransactionAsync(
            cancellationToken
        );
        await context
            .PasswordResets.Where(reset => reset.ExpiresAt <= now || reset.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
        context.PasswordResets.Add(
            new PasswordReset
            {
                TokenHash = tokenHash,
                UserId = userId,
                CreatedAt = now,
                ExpiresAt = expiresAt,
            }
        );
        await context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<bool> TryRedeemAsync(
        string tokenHash,
        string passwordHash,
        DateTimeOffset now,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await using var transaction = await context.Database.BeginTransactionAsync(
            cancellationToken
        );
        var reset = await context
            .PasswordResets.AsNoTracking()
            .Where(pending => pending.TokenHash == tokenHash)
            .Select(pending => new { pending.UserId, pending.ExpiresAt })
            .SingleOrDefaultAsync(cancellationToken);
        if (reset is null)
            return false;
        // The delete is the claim. A concurrent redeemer (or a superseding issue)
        // blocks on the row lock, re-checks after the first commits and deletes
        // nothing, so exactly one caller sees one affected row.
        var claimed = await context
            .PasswordResets.Where(pending => pending.TokenHash == tokenHash)
            .ExecuteDeleteAsync(cancellationToken);
        if (claimed != 1)
            return false;
        if (reset.ExpiresAt > now)
        {
            await context
                .Users.Where(user => user.Id == reset.UserId)
                .ExecuteUpdateAsync(
                    set => set.SetProperty(user => user.Password, passwordHash),
                    cancellationToken
                );
            // Push devices registered to these sessions cascade in the database.
            await context
                .Sessions.Where(session => session.UserId == reset.UserId)
                .ExecuteDeleteAsync(cancellationToken);
        }
        // An expired code is purged and still rejected.
        await transaction.CommitAsync(cancellationToken);
        return reset.ExpiresAt > now;
    }
}
