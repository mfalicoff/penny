using System.Data;
using System.Linq.Expressions;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Mail;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Repositories;

// The mail outbox (MAZ-124), with the push outbox's lease discipline: candidates are
// read, one conditional EF update leases them (a competing claim waits on the row lock
// and re-checks the predicate), then the rows leased to this token are read back. No
// raw SQL.
public sealed class PostgresMailOutbox(NpgsqlDataSource source) : IMailOutbox
{
    public async Task<bool> EnqueuePasswordResetAsync(
        string userId,
        string recipientHash,
        string locale,
        MailPolicy policy,
        DateTimeOffset now,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await using var transaction = await context.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            cancellationToken
        );
        // The user row lock serializes requests for one account, so the checks below
        // and the insert cannot interleave with another request's.
        if (
            await context
                .Users.Where(user => user.Id == userId)
                .ExecuteUpdateAsync(
                    set => set.SetProperty(user => user.Email, user => user.Email),
                    cancellationToken
                ) == 0
        )
            return false;
        var since = now - MailPolicy.LimitWindow;
        var pending = await context.MailOutbox.AnyAsync(
            message =>
                message.UserId == userId
                && message.Kind == MailKinds.PasswordReset
                && message.FinishedAt == null,
            cancellationToken
        );
        var account = await context.MailOutbox.CountAsync(
            message => message.AccountId == userId && message.CreatedAt > since,
            cancellationToken
        );
        var recipient = await context.MailOutbox.CountAsync(
            message => message.RecipientHash == recipientHash && message.CreatedAt > since,
            cancellationToken
        );
        if (
            pending
            || account >= policy.AccountMessagesPerDay
            || recipient >= policy.RecipientMessagesPerDay
        )
            return false;
        context.MailOutbox.Add(
            new MailOutboxMessage
            {
                Id = RandomNumberGenerator.GetHexString(32, lowercase: true),
                Kind = MailKinds.PasswordReset,
                UserId = userId,
                AccountId = userId,
                RecipientHash = recipientHash,
                Locale = locale,
                CreatedAt = now,
                NextAttemptAt = now,
            }
        );
        await context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    public async Task<IReadOnlyList<MailClaim>> ClaimAsync(
        string leaseOwner,
        string leaseToken,
        DateTimeOffset now,
        DateTimeOffset leaseUntil,
        int limit,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        Expression<Func<MailOutboxMessage, bool>> due = message =>
            message.FinishedAt == null
            && message.NextAttemptAt <= now
            && (message.LeaseExpiresAt == null || message.LeaseExpiresAt <= now);
        var candidates = await context
            .MailOutbox.AsNoTracking()
            .Where(due)
            .OrderBy(message => message.NextAttemptAt)
            .ThenBy(message => message.Id)
            .Take(limit)
            .Select(message => message.Id)
            .ToListAsync(cancellationToken);
        if (candidates.Count == 0)
            return [];
        await context
            .MailOutbox.Where(message => candidates.Contains(message.Id))
            .Where(due)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(message => message.LeaseOwner, leaseOwner)
                        .SetProperty(message => message.LeaseToken, leaseToken)
                        .SetProperty(message => message.LeaseExpiresAt, leaseUntil),
                cancellationToken
            );
        return await context
            .MailOutbox.AsNoTracking()
            .Where(message => candidates.Contains(message.Id) && message.LeaseToken == leaseToken)
            .OrderBy(message => message.NextAttemptAt)
            .ThenBy(message => message.Id)
            .Select(message => new MailClaim(
                message.Id,
                message.Kind,
                message.UserId,
                message.EmailInviteId,
                message.Locale,
                message.CreatedAt,
                message.Attempts
            ))
            .ToListAsync(cancellationToken);
    }

    public async Task RecordAsync(
        string messageId,
        string leaseToken,
        MailResult result,
        DateTimeOffset now,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await using var transaction = await context.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            cancellationToken
        );
        var message = context.MailOutbox.Where(row => row.Id == messageId);
        var stored = await message
            .AsNoTracking()
            .Select(row => new { row.EmailInviteId, row.CreatedAt })
            .SingleOrDefaultAsync(cancellationToken);
        if (stored is null)
            return;
        var reason = Truncate(result.Reason);
        // A message revoked or superseded meanwhile is already finished and keeps its
        // finish time and reason; its attempt is still counted.
        await message.ExecuteUpdateAsync(
            set => set.SetProperty(row => row.Attempts, row => row.Attempts + 1),
            cancellationToken
        );
        var open = message.Where(row => row.FinishedAt == null);
        switch (result.Kind)
        {
            case MailOutcomeKind.Retry:
                await open.ExecuteUpdateAsync(
                    set =>
                        set.SetProperty(row => row.NextAttemptAt, result.RetryAt ?? now)
                            .SetProperty(row => row.LastError, reason),
                    cancellationToken
                );
                break;
            case MailOutcomeKind.Sent:
                await message.ExecuteUpdateAsync(
                    set => set.SetProperty(row => row.SentAt, now),
                    cancellationToken
                );
                await open.ExecuteUpdateAsync(
                    set =>
                        set.SetProperty(row => row.FinishedAt, now)
                            .SetProperty(row => row.LastError, (string?)null),
                    cancellationToken
                );
                break;
            default:
                await open.ExecuteUpdateAsync(
                    set =>
                        set.SetProperty(row => row.FinishedAt, now)
                            .SetProperty(row => row.LastError, reason),
                    cancellationToken
                );
                break;
        }
        // Only the invitation's latest email decides its status: one superseded by a
        // resend that is sent or fails later says nothing about the resend.
        if (
            stored.EmailInviteId is { } inviteId
            && result.Kind is MailOutcomeKind.Sent or MailOutcomeKind.Permanent
            && !await context.MailOutbox.AnyAsync(
                other =>
                    other.EmailInviteId == inviteId
                    && other.Id != messageId
                    && other.CreatedAt >= stored.CreatedAt,
                cancellationToken
            )
        )
        {
            var invite = context.HouseholdEmailInvites.Where(row =>
                row.Id == inviteId && row.RevokedAt == null && row.JoinedAt == null
            );
            if (result.Kind == MailOutcomeKind.Sent)
                await invite.ExecuteUpdateAsync(
                    set =>
                        set.SetProperty(row => row.SentAt, now)
                            .SetProperty(row => row.FailedAt, (DateTimeOffset?)null),
                    cancellationToken
                );
            else
                await invite.ExecuteUpdateAsync(
                    set => set.SetProperty(row => row.FailedAt, now),
                    cancellationToken
                );
        }
        await context
            .MailOutbox.Where(row => row.Id == messageId && row.LeaseToken == leaseToken)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(row => row.LeaseOwner, (string?)null)
                        .SetProperty(row => row.LeaseToken, (string?)null)
                        .SetProperty(row => row.LeaseExpiresAt, (DateTimeOffset?)null),
                cancellationToken
            );
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<int> PurgeAsync(
        DateTimeOffset createdBefore,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        return await context
            .MailOutbox.Where(message =>
                message.FinishedAt != null && message.CreatedAt < createdBefore
            )
            .ExecuteDeleteAsync(cancellationToken);
    }

    private static string? Truncate(string? reason) =>
        reason is { Length: > 200 } ? reason[..200] : reason;
}
