using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Repositories;

public sealed class PostgresEmailVerificationRepository(NpgsqlDataSource source)
    : IEmailVerificationRepository
{
    public async Task ReplaceAsync(
        string userId,
        string email,
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
            .EmailVerifications.Where(verification =>
                verification.ExpiresAt <= now || verification.UserId == userId
            )
            .ExecuteDeleteAsync(cancellationToken);
        context.EmailVerifications.Add(
            new EmailVerification
            {
                TokenHash = tokenHash,
                UserId = userId,
                Email = email,
                CreatedAt = now,
                ExpiresAt = expiresAt,
            }
        );
        await context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<string?> TryRedeemAsync(
        string tokenHash,
        DateTimeOffset now,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await using var transaction = await context.Database.BeginTransactionAsync(
            cancellationToken
        );
        var pending = await context
            .EmailVerifications.AsNoTracking()
            .Where(verification => verification.TokenHash == tokenHash)
            .Select(verification => new
            {
                verification.UserId,
                verification.Email,
                verification.ExpiresAt,
            })
            .SingleOrDefaultAsync(cancellationToken);
        if (pending is null)
            return null;
        // The delete is the claim, as for password resets: a concurrent redeemer (or a
        // superseding code, or an email change) blocks on the row lock, re-checks after the
        // first commits and deletes nothing.
        var claimed = await context
            .EmailVerifications.Where(verification => verification.TokenHash == tokenHash)
            .ExecuteDeleteAsync(cancellationToken);
        if (claimed != 1)
            return null;
        var verified = false;
        if (pending.ExpiresAt > now)
        {
            // Only while the account still has the address the code was sent to; the
            // first verification time is kept.
            var current = await context
                .Users.Where(user => user.Id == pending.UserId && user.Email == pending.Email)
                .ExecuteUpdateAsync(
                    set =>
                        set.SetProperty(
                            user => user.EmailVerifiedAt,
                            user => user.EmailVerifiedAt ?? now
                        ),
                    cancellationToken
                );
            verified = current == 1;
        }
        // An expired or stale code is purged and still rejected.
        await transaction.CommitAsync(cancellationToken);
        return verified ? pending.Email : null;
    }
}
