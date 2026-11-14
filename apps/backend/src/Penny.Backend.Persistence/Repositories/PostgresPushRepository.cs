using System.Data;
using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Application.Push;
using Penny.Backend.Domain.Errors;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Repositories;

// Push devices and the delivery outbox (MAZ-61), with the MAZ-59 lease discipline:
// candidates are read, then one conditional EF update leases them (the row lock
// serializes competing claims and a loser re-checks the predicate against the
// winner's lease), then the rows leased to this token are read back. Per-message
// work runs in READ COMMITTED transactions that first extend the message's lease with
// a conditional update, holding its row lock until commit. No raw SQL.
public sealed class PostgresPushRepository(NpgsqlDataSource source) : IPushRepository
{
    public const string DeviceRemoved = "device-removed";
    public const string DeviceTransferred = "device-transferred";
    public const string Expired = "expired";

    public async Task RegisterAsync(
        string userId,
        string sessionHash,
        PushDeviceRegistration device,
        DateTimeOffset now,
        CancellationToken cancellationToken
    )
    {
        // Two sessions registering one new token race on its primary key; the loser
        // retries once and updates the winner's row.
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                await UpsertAsync(userId, sessionHash, device, now, cancellationToken);
                return;
            }
            catch (DbUpdateException error)
                when (error.InnerException
                        is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation }
                    && attempt == 0
                )
            {
                continue;
            }
            catch (DbUpdateException error)
                when (error.InnerException
                        is PostgresException { SqlState: PostgresErrorCodes.ForeignKeyViolation }
                )
            {
                // The session ended (logout) between authentication and this write.
                throw new BackendFailure(FailureKind.Unauthorized, AuthService.SignInRequired);
            }
        }
    }

    private async Task UpsertAsync(
        string userId,
        string sessionHash,
        PushDeviceRegistration device,
        DateTimeOffset now,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await using var transaction = await context.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            cancellationToken
        );
        await FinishTokenAsync(
            context,
            device.Token,
            now,
            DeviceTransferred,
            delivery =>
                context.PushOutbox.Any(message =>
                    message.Id == delivery.OutboxId && message.UserId != userId
                ),
            cancellationToken
        );
        var stored = await context.PushDevices.SingleOrDefaultAsync(
            row => row.Token == device.Token,
            cancellationToken
        );
        if (stored is null)
            context.PushDevices.Add(
                new PushDevice
                {
                    Token = device.Token,
                    UserId = userId,
                    SessionHash = sessionHash,
                    Platform = device.Platform,
                    Provider = device.Provider,
                    Environment = device.Environment,
                    UpdatedAt = now,
                }
            );
        else
        {
            stored.UserId = userId;
            stored.SessionHash = sessionHash;
            stored.Platform = device.Platform;
            stored.Provider = device.Provider;
            stored.Environment = device.Environment;
            stored.UpdatedAt = now;
        }
        await context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task RemoveAsync(
        string userId,
        string sessionHash,
        string token,
        DateTimeOffset now,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await using var transaction = await context.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            cancellationToken
        );
        var removed = await context
            .PushDevices.Where(device =>
                device.Token == token
                && device.UserId == userId
                && device.SessionHash == sessionHash
            )
            .ExecuteDeleteAsync(cancellationToken);
        if (removed > 0)
            await FinishTokenAsync(context, token, now, DeviceRemoved, null, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<PushClaim>> ClaimAsync(
        string leaseOwner,
        string leaseToken,
        DateTimeOffset now,
        DateTimeOffset leaseUntil,
        int limit,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        Expression<Func<PushOutboxMessage, bool>> due = message =>
            message.SentAt == null
            && message.NextAttemptAt <= now
            && (message.LeaseExpiresAt == null || message.LeaseExpiresAt <= now);
        var candidates = await context
            .PushOutbox.AsNoTracking()
            .Where(due)
            .OrderBy(message => message.NextAttemptAt)
            .ThenBy(message => message.Id)
            .Take(limit)
            .Select(message => message.Id)
            .ToListAsync(cancellationToken);
        if (candidates.Count == 0)
            return [];
        await context
            .PushOutbox.Where(message => candidates.Contains(message.Id))
            .Where(due)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(message => message.LeaseOwner, leaseOwner)
                        .SetProperty(message => message.LeaseToken, leaseToken)
                        .SetProperty(message => message.LeaseExpiresAt, leaseUntil),
                cancellationToken
            );
        return await context
            .PushOutbox.AsNoTracking()
            .Where(message => candidates.Contains(message.Id) && message.LeaseToken == leaseToken)
            .OrderBy(message => message.NextAttemptAt)
            .ThenBy(message => message.Id)
            .Select(message => new PushClaim(
                message.Id,
                message.UserId,
                message.EventType,
                message.Payload,
                message.CreatedAt
            ))
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<PushDispatch>?> PrepareAsync(
        string outboxId,
        string leaseToken,
        DateTimeOffset now,
        DateTimeOffset leaseUntil,
        DateTimeOffset expiredBefore,
        int limit,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await using var transaction = await context.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            cancellationToken
        );
        if (!await ExtendAsync(context, outboxId, leaseToken, leaseUntil, cancellationToken))
            return null;
        var message = await context
            .PushOutbox.AsNoTracking()
            .Where(row => row.Id == outboxId)
            .Select(row => new { row.UserId, row.CreatedAt })
            .SingleAsync(cancellationToken);
        if (message.CreatedAt < expiredBefore)
        {
            await FinishPendingAsync(
                context.PushDeliveries.Where(delivery => delivery.OutboxId == outboxId),
                now,
                Expired,
                cancellationToken
            );
            await context
                .PushOutbox.Where(row => row.Id == outboxId)
                .ExecuteUpdateAsync(
                    set => set.SetProperty(row => row.LastError, Expired),
                    cancellationToken
                );
            await SettleAsync(context, outboxId, leaseToken, now, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return [];
        }
        var userId = message.UserId;
        // Live devices of the recipient: registered by this user under a session that
        // has not expired (logout deletes the session and, by cascade, its devices).
        var live = context.PushDevices.Where(device =>
            device.UserId == userId
            && context.Sessions.Any(session =>
                session.TokenHash == device.SessionHash && session.ExpiresAt > now
            )
        );
        if (
            !await context.PushDeliveries.AnyAsync(
                delivery => delivery.OutboxId == outboxId,
                cancellationToken
            )
        )
        {
            var tokens = await live.AsNoTracking()
                .Select(device => device.Token)
                .ToListAsync(cancellationToken);
            context.PushDeliveries.AddRange(
                tokens.Select(token => new PushDelivery
                {
                    OutboxId = outboxId,
                    Token = token,
                    NextAttemptAt = now,
                })
            );
            await context.SaveChangesAsync(cancellationToken);
        }
        // A logged-out, expired or transferred device must never receive this user's data.
        await FinishPendingAsync(
            context.PushDeliveries.Where(delivery =>
                delivery.OutboxId == outboxId && !live.Any(device => device.Token == delivery.Token)
            ),
            now,
            DeviceRemoved,
            cancellationToken
        );
        var dispatches = (
            await context
                .PushDeliveries.AsNoTracking()
                .Where(delivery =>
                    delivery.OutboxId == outboxId
                    && delivery.SentAt == null
                    && delivery.NextAttemptAt <= now
                )
                .Join(
                    live,
                    delivery => delivery.Token,
                    device => device.Token,
                    (delivery, device) =>
                        new
                        {
                            delivery.Token,
                            device.Provider,
                            device.Environment,
                            delivery.Attempts,
                        }
                )
                .OrderBy(row => row.Token)
                .Take(limit)
                .ToListAsync(cancellationToken)
        ).Select(row => new PushDispatch(outboxId, row.Token, row.Provider, row.Environment, row.Attempts + 1)).ToList();
        if (dispatches.Count == 0)
            await SettleAsync(context, outboxId, leaseToken, now, cancellationToken);
        else
        {
            var tokens = dispatches.Select(dispatch => dispatch.Token).ToList();
            // Counted before sending, and not due again before the lease ends, so a
            // crash never loses an attempt and a takeover resends at most once.
            await context
                .PushDeliveries.Where(delivery =>
                    delivery.OutboxId == outboxId && tokens.Contains(delivery.Token)
                )
                .ExecuteUpdateAsync(
                    set =>
                        set.SetProperty(
                                delivery => delivery.Attempts,
                                delivery => delivery.Attempts + 1
                            )
                            .SetProperty(delivery => delivery.NextAttemptAt, leaseUntil),
                    cancellationToken
                );
        }
        await transaction.CommitAsync(cancellationToken);
        return dispatches;
    }

    public async Task RecordAsync(
        string outboxId,
        string leaseToken,
        IReadOnlyList<PushDeliveryResult> results,
        DateTimeOffset now,
        DateTimeOffset claimedAt,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await using var transaction = await context.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            cancellationToken
        );
        // Outcomes are facts about sends that happened, so they are recorded even if
        // the lease was lost meanwhile; only the lease release depends on owning it.
        await ExtendAsync(context, outboxId, leaseToken, now, cancellationToken);
        string? lastError = null;
        foreach (var result in results)
        {
            var delivery = context.PushDeliveries.Where(row =>
                row.OutboxId == outboxId && row.Token == result.Token && row.SentAt == null
            );
            switch (result.Kind)
            {
                case PushOutcomeKind.Accepted:
                    await delivery.ExecuteUpdateAsync(
                        set =>
                            set.SetProperty(row => row.SentAt, now)
                                .SetProperty(row => row.TicketId, result.TicketId)
                                .SetProperty(row => row.NextAttemptAt, now)
                                .SetProperty(row => row.LastError, (string?)null),
                        cancellationToken
                    );
                    break;
                case PushOutcomeKind.Retry:
                    lastError = result.Reason;
                    await delivery.ExecuteUpdateAsync(
                        set =>
                            set.SetProperty(row => row.NextAttemptAt, result.RetryAt ?? now)
                                .SetProperty(row => row.LastError, result.Reason),
                        cancellationToken
                    );
                    break;
                case PushOutcomeKind.Permanent:
                    lastError = result.Reason;
                    await FinishPendingAsync(delivery, now, result.Reason, cancellationToken);
                    break;
                case PushOutcomeKind.InvalidToken:
                    lastError = result.Reason;
                    await FinishPendingAsync(delivery, now, result.Reason, cancellationToken);
                    await RemoveInvalidAsync(
                        context,
                        result.Token,
                        claimedAt,
                        now,
                        result.Reason,
                        cancellationToken
                    );
                    break;
            }
        }
        if (lastError is not null)
            await context
                .PushOutbox.Where(row => row.Id == outboxId)
                .ExecuteUpdateAsync(
                    set =>
                        set.SetProperty(row => row.LastError, Truncate(lastError))
                            .SetProperty(row => row.Attempts, row => row.Attempts + 1),
                    cancellationToken
                );
        else
            await context
                .PushOutbox.Where(row => row.Id == outboxId)
                .ExecuteUpdateAsync(
                    set => set.SetProperty(row => row.Attempts, row => row.Attempts + 1),
                    cancellationToken
                );
        await SettleAsync(context, outboxId, leaseToken, now, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    // Deletes a token a provider rejected, unless it was registered again after the
    // rejected send (a fresh registration proves it valid), and finishes every pending
    // delivery to it. Other messages settle when next claimed.
    private static async Task RemoveInvalidAsync(
        PennyDbContext context,
        string token,
        DateTimeOffset sentBefore,
        DateTimeOffset now,
        string? reason,
        CancellationToken cancellationToken
    )
    {
        var removed = await context
            .PushDevices.Where(device => device.Token == token && device.UpdatedAt <= sentBefore)
            .ExecuteDeleteAsync(cancellationToken);
        if (removed > 0)
            await FinishTokenAsync(context, token, now, reason, null, cancellationToken);
    }

    private static Task FinishTokenAsync(
        PennyDbContext context,
        string token,
        DateTimeOffset now,
        string? reason,
        Expression<Func<PushDelivery, bool>>? filter,
        CancellationToken cancellationToken
    )
    {
        var deliveries = context.PushDeliveries.Where(delivery => delivery.Token == token);
        if (filter is not null)
            deliveries = deliveries.Where(filter);
        return FinishPendingAsync(deliveries, now, reason, cancellationToken);
    }

    // Ends deliveries undelivered: sent_at marks them final.
    private static Task<int> FinishPendingAsync(
        IQueryable<PushDelivery> deliveries,
        DateTimeOffset now,
        string? reason,
        CancellationToken cancellationToken
    )
    {
        var error = Truncate(reason);
        return deliveries
            .Where(delivery => delivery.SentAt == null)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(delivery => delivery.SentAt, now)
                        .SetProperty(delivery => delivery.LastError, error),
                cancellationToken
            );
    }

    // Extends this runner's lease; also takes the message's row lock until commit.
    private static async Task<bool> ExtendAsync(
        PennyDbContext context,
        string outboxId,
        string leaseToken,
        DateTimeOffset leaseUntil,
        CancellationToken cancellationToken
    ) =>
        await context
            .PushOutbox.Where(message =>
                message.Id == outboxId && message.LeaseToken == leaseToken && message.SentAt == null
            )
            .ExecuteUpdateAsync(
                set => set.SetProperty(message => message.LeaseExpiresAt, leaseUntil),
                cancellationToken
            ) > 0;

    // Marks the message sent once no delivery is pending, otherwise schedules it for
    // its earliest pending delivery; releases this runner's lease.
    private static async Task SettleAsync(
        PennyDbContext context,
        string outboxId,
        string leaseToken,
        DateTimeOffset now,
        CancellationToken cancellationToken
    )
    {
        var next = await context
            .PushDeliveries.Where(delivery =>
                delivery.OutboxId == outboxId && delivery.SentAt == null
            )
            .MinAsync(delivery => (DateTimeOffset?)delivery.NextAttemptAt, cancellationToken);
        DateTimeOffset? sentAt = next is null ? now : null;
        var nextAt = next ?? now;
        await context
            .PushOutbox.Where(message =>
                message.Id == outboxId && message.LeaseToken == leaseToken && message.SentAt == null
            )
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(message => message.SentAt, sentAt)
                        .SetProperty(message => message.NextAttemptAt, nextAt)
                        .SetProperty(message => message.LeaseOwner, (string?)null)
                        .SetProperty(message => message.LeaseToken, (string?)null)
                        .SetProperty(message => message.LeaseExpiresAt, (DateTimeOffset?)null),
                cancellationToken
            );
    }

    private static string? Truncate(string? reason) =>
        reason is { Length: > 500 } ? reason[..500] : reason;
}
