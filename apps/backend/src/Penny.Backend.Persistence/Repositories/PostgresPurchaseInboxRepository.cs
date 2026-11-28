using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Repositories;

// Captured purchases in the owner-only Inbox (MAZ-291). Each state change is one
// conditional UPDATE, so two devices triaging the same item at once cannot both win:
// the second sees the first one's outcome.
public sealed class PostgresPurchaseInboxRepository(NpgsqlDataSource source)
    : IPurchaseInboxRepository
{
    private const string ToReview = "to_review";
    private const string Done = "done";

    public async Task<PurchaseCreateResult> CreateAsync(
        string userId,
        PurchaseCapture capture,
        DateTimeOffset now,
        DateTimeOffset doneBefore,
        int maxToReview,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        if (
            await ByKeyAsync(context, userId, capture.IdempotencyKey, cancellationToken) is
            { } existing
        )
            return new(existing, false);
        await context
            .CapturedPurchases.Where(item =>
                item.UserId == userId && item.Status == Done && item.ResolvedAt < doneBefore
            )
            .ExecuteDeleteAsync(cancellationToken);
        var waiting = await context.CapturedPurchases.CountAsync(
            item => item.UserId == userId && item.Status == ToReview,
            cancellationToken
        );
        if (waiting >= maxToReview)
            return new(null, false);
        var row = new CapturedPurchase
        {
            Id = RandomNumberGenerator.GetHexString(32, lowercase: true),
            UserId = userId,
            IdempotencyKey = capture.IdempotencyKey,
            Merchant = capture.Merchant,
            Amount = capture.Amount,
            Currency = capture.Currency,
            Card = capture.Card,
            CapturedAt = capture.CapturedAt,
            CreatedAt = now,
            Status = ToReview,
        };
        context.CapturedPurchases.Add(row);
        try
        {
            await context.SaveChangesAsync(cancellationToken);
            return new(Of(row), true);
        }
        catch (DbUpdateException error)
            when (error.InnerException
                    is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation }
            )
        {
            // The same tap was uploaded twice at once; the other copy was stored.
            await using var retry = PennyDbContext.Create(source);
            var stored = await ByKeyAsync(retry, userId, capture.IdempotencyKey, cancellationToken)
                ?? throw new InvalidOperationException("The concurrent capture disappeared.");
            return new(stored, false);
        }
    }

    public async Task<IReadOnlyList<StoredPurchase>> ListAsync(
        string userId,
        bool done,
        DateTimeOffset doneSince,
        string? before,
        int limit,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        var items = context.CapturedPurchases.AsNoTracking().Where(item => item.UserId == userId);
        items = done
            ? items.Where(item => item.Status == Done && item.ResolvedAt > doneSince)
            : items.Where(item => item.Status == ToReview);
        if (before is not null)
        {
            var cursor = await context
                .CapturedPurchases.AsNoTracking()
                .Where(item => item.UserId == userId && item.Id == before)
                .Select(item => new { item.CapturedAt, item.Id })
                .SingleOrDefaultAsync(cancellationToken);
            if (cursor is null)
                return [];
            items = items.Where(item =>
                item.CapturedAt < cursor.CapturedAt
                || (item.CapturedAt == cursor.CapturedAt && string.Compare(item.Id, cursor.Id) < 0)
            );
        }
        var rows = await items
            .OrderByDescending(item => item.CapturedAt)
            .ThenByDescending(item => item.Id)
            .Take(limit)
            .ToListAsync(cancellationToken);
        return [.. rows.Select(Of)];
    }

    public async Task<StoredPurchase?> FindAsync(
        string userId,
        string id,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        return await FindAsync(context, userId, id, cancellationToken);
    }

    public async Task<StoredPurchase?> ResolveAsync(
        string userId,
        string id,
        PurchaseResolution resolution,
        DateTimeOffset now,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await context
            .CapturedPurchases.Where(item =>
                item.UserId == userId && item.Id == id && item.Status == ToReview
            )
            .ExecuteUpdateAsync(
                update =>
                    update
                        .SetProperty(item => item.Status, Done)
                        .SetProperty(item => item.Outcome, resolution.Outcome)
                        .SetProperty(item => item.EntryId, resolution.EntryId)
                        .SetProperty(item => item.HouseholdId, resolution.HouseholdId)
                        .SetProperty(item => item.ResolvedAt, now),
                cancellationToken
            );
        return await FindAsync(context, userId, id, cancellationToken);
    }

    public async Task<StoredPurchase?> ReopenAsync(
        string userId,
        string id,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await context
            .CapturedPurchases.Where(item =>
                item.UserId == userId && item.Id == id && item.Status == Done
            )
            .ExecuteUpdateAsync(
                update =>
                    update
                        .SetProperty(item => item.Status, ToReview)
                        .SetProperty(item => item.Outcome, (string?)null)
                        .SetProperty(item => item.EntryId, (string?)null)
                        .SetProperty(item => item.HouseholdId, (string?)null)
                        .SetProperty(item => item.ResolvedAt, (DateTimeOffset?)null),
                cancellationToken
            );
        return await FindAsync(context, userId, id, cancellationToken);
    }

    public async Task<IReadOnlyList<StoredCardAccount>> CardsAsync(
        string userId,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        var rows = await context
            .CardAccounts.AsNoTracking()
            .Where(card => card.UserId == userId)
            .ToListAsync(cancellationToken);
        return
        [
            .. rows.OrderBy(card => card.Card, StringComparer.OrdinalIgnoreCase)
                .Select(card => new StoredCardAccount(card.Card, card.AccountId)),
        ];
    }

    public async Task ReplaceCardsAsync(
        string userId,
        IReadOnlyList<StoredCardAccount> cards,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await using var transaction = await context.Database.BeginTransactionAsync(
            cancellationToken
        );
        await context
            .CardAccounts.Where(card => card.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
        context.CardAccounts.AddRange(
            cards.Select(card => new CardAccount
            {
                UserId = userId,
                Card = card.Card,
                AccountId = card.AccountId,
            })
        );
        await context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private static async Task<StoredPurchase?> FindAsync(
        PennyDbContext context,
        string userId,
        string id,
        CancellationToken cancellationToken
    )
    {
        var row = await context
            .CapturedPurchases.AsNoTracking()
            .SingleOrDefaultAsync(
                item => item.UserId == userId && item.Id == id,
                cancellationToken
            );
        return row is null ? null : Of(row);
    }

    private static async Task<StoredPurchase?> ByKeyAsync(
        PennyDbContext context,
        string userId,
        string key,
        CancellationToken cancellationToken
    )
    {
        var row = await context
            .CapturedPurchases.AsNoTracking()
            .SingleOrDefaultAsync(
                item => item.UserId == userId && item.IdempotencyKey == key,
                cancellationToken
            );
        return row is null ? null : Of(row);
    }

    private static StoredPurchase Of(CapturedPurchase row) =>
        new(
            row.Id,
            row.Merchant,
            row.Amount,
            row.Currency,
            row.Card,
            row.CapturedAt,
            row.CreatedAt,
            row.Status,
            row.Outcome,
            row.EntryId,
            row.HouseholdId,
            row.ResolvedAt
        );
}
