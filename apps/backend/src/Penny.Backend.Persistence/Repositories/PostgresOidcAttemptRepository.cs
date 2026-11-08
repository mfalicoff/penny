using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Repositories;

public sealed class PostgresOidcAttemptRepository(NpgsqlDataSource source) : IOidcAttemptRepository
{
    public async Task<bool> TryCreateAsync(
        StoredOidcAttempt attempt,
        DateTimeOffset now,
        int limit,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await context
            .OidcAttempts.Where(pending => pending.ExpiresAt <= now)
            .ExecuteDeleteAsync(cancellationToken);
        // A flood guard, not an exact quota: concurrent starts may each see room.
        if (await context.OidcAttempts.CountAsync(cancellationToken) >= limit)
            return false;
        context.OidcAttempts.Add(
            new OidcAttempt
            {
                TransactionHash = attempt.TransactionHash,
                RedirectUri = attempt.RedirectUri,
                State = attempt.State,
                Nonce = attempt.Nonce,
                CodeVerifier = attempt.CodeVerifier,
                ExpiresAt = attempt.ExpiresAt,
            }
        );
        await context.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<StoredOidcAttempt?> ConsumeAsync(
        string transactionHash,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        var attempt = await context
            .OidcAttempts.AsNoTracking()
            .Where(pending => pending.TransactionHash == transactionHash)
            .Select(pending => new StoredOidcAttempt(
                pending.TransactionHash,
                pending.RedirectUri,
                pending.State,
                pending.Nonce,
                pending.CodeVerifier,
                pending.ExpiresAt
            ))
            .SingleOrDefaultAsync(cancellationToken);
        if (attempt is null)
            return null;
        // The delete is the claim. A concurrent deleter of the same row blocks on its
        // row lock, re-checks after the first commits and deletes nothing, so exactly
        // one caller sees one affected row.
        var claimed = await context
            .OidcAttempts.Where(pending => pending.TransactionHash == transactionHash)
            .ExecuteDeleteAsync(cancellationToken);
        return claimed == 1 ? attempt : null;
    }

    public async Task RemoveAsync(string transactionHash, CancellationToken cancellationToken)
    {
        await using var context = PennyDbContext.Create(source);
        await context
            .OidcAttempts.Where(pending => pending.TransactionHash == transactionHash)
            .ExecuteDeleteAsync(cancellationToken);
    }
}
