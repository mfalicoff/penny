using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.InboundMail;
using Penny.Backend.Persistence.InboundMail;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Repositories;

// Receipt addresses and the raw inbound queue (MAZ-184). Addresses and allowed senders
// are sealed; only the local part hash is searchable.
public sealed class PostgresReceiptMailRepository(NpgsqlDataSource source, InboundMailSealer sealer)
    : IReceiptMailRepository
{
    private const string AddressPart = "address";
    private const string SendersPart = "allowed-senders";
    private const string RawPart = "raw";
    private static readonly string[] Waiting = ["pending", "processing"];
    private static readonly string[] Unhandled = ["to_attach", "partly_attached"];

    public async Task<StoredMailAddress?> ReadCurrentAsync(
        string userId,
        DateTimeOffset now,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        var row = await Live(context, now)
            .AsNoTracking()
            .SingleOrDefaultAsync(address => address.UserId == userId, cancellationToken);
        return row is null ? null : Open(row);
    }

    public async Task<int> CountCreatedSinceAsync(
        string userId,
        DateTimeOffset since,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        return await context.ReceiptMailAddresses.CountAsync(
            address => address.UserId == userId && address.CreatedAt > since,
            cancellationToken
        );
    }

    // Two rotations at once: the later insert collides with the earlier one's new row on
    // the one-live-address index, and a fresh attempt revokes that row instead.
    public async Task<StoredMailAddress> ReplaceAsync(
        string userId,
        string address,
        string localPartHash,
        DateTimeOffset createdAt,
        DateTimeOffset expiresAt,
        CancellationToken cancellationToken
    )
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return await TryReplaceAsync(
                    userId,
                    address,
                    localPartHash,
                    createdAt,
                    expiresAt,
                    cancellationToken
                );
            }
            catch (DbUpdateException error) when (attempt < 3 && IsUniqueViolation(error)) { }
        }
    }

    private async Task<StoredMailAddress> TryReplaceAsync(
        string userId,
        string address,
        string localPartHash,
        DateTimeOffset createdAt,
        DateTimeOffset expiresAt,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await using var transaction = await context.Database.BeginTransactionAsync(
            cancellationToken
        );
        var current = await context
            .ReceiptMailAddresses.AsNoTracking()
            .Where(row => row.UserId == userId && row.RevokedAt == null)
            .SingleOrDefaultAsync(cancellationToken);
        IReadOnlyList<string> senders = current is null ? [] : Open(current).AllowedSenders;
        await context
            .ReceiptMailAddresses.Where(row => row.UserId == userId && row.RevokedAt == null)
            .ExecuteUpdateAsync(
                update => update.SetProperty(row => row.RevokedAt, createdAt),
                cancellationToken
            );
        var row = Seal(
            userId,
            RandomNumberGenerator.GetHexString(32, lowercase: true),
            address,
            localPartHash,
            senders,
            createdAt,
            expiresAt
        );
        context.ReceiptMailAddresses.Add(row);
        await context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Open(row);
    }

    public async Task<StoredMailAddress?> UpdateAsync(
        string userId,
        DateTimeOffset now,
        DateTimeOffset? expiresAt,
        IReadOnlyList<string>? allowedSenders,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        var row = await Live(context, now)
            .SingleOrDefaultAsync(address => address.UserId == userId, cancellationToken);
        if (row is null)
            return null;
        if (expiresAt is { } expiry)
            row.ExpiresAt = expiry;
        if (allowedSenders is not null)
        {
            row.AllowedSendersNonce = InboundMailSealer.NewNonce();
            row.AllowedSendersEncrypted = sealer.SealText(
                row.KeySalt,
                row.AllowedSendersNonce,
                JsonSerializer.Serialize(allowedSenders),
                SendersPart,
                userId,
                row.Id
            );
        }
        await context.SaveChangesAsync(cancellationToken);
        return Open(row);
    }

    public async Task RevokeAsync(
        string userId,
        DateTimeOffset now,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await context
            .ReceiptMailAddresses.Where(address =>
                address.UserId == userId && address.RevokedAt == null
            )
            .ExecuteUpdateAsync(
                update => update.SetProperty(address => address.RevokedAt, now),
                cancellationToken
            );
    }

    public async Task<IReadOnlyList<string>> LiveHashesAsync(
        DateTimeOffset now,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        return await Live(context, now)
            .OrderBy(address => address.LocalPartHash)
            .Select(address => address.LocalPartHash)
            .ToListAsync(cancellationToken);
    }

    // File first (sealed, temp, fsync, no-overwrite rename), then the row, as receipt
    // uploads do. Limits are counted just before the insert; concurrent deliveries to
    // one address can overshoot a limit by the number in flight, which is acceptable
    // for a noise filter.
    public async Task<InboundAcceptOutcome> AcceptAsync(
        InboundDelivery delivery,
        InboundMailSettings limits,
        CancellationToken cancellationToken
    )
    {
        var now = delivery.ReceivedAt;
        await using var context = PennyDbContext.Create(source);
        var address = await Live(context, now)
            .AsNoTracking()
            .Where(row => row.LocalPartHash == delivery.LocalPartHash)
            .Select(row => new { row.Id, row.UserId })
            .SingleOrDefaultAsync(cancellationToken);
        if (address is null)
            return InboundAcceptOutcome.UnknownAddress;
        var sha256 = Convert.ToHexStringLower(SHA256.HashData(delivery.Raw));
        if (
            await context.InboundMessages.AnyAsync(
                message => message.UserId == address.UserId && message.Sha256 == sha256,
                cancellationToken
            )
        )
            return InboundAcceptOutcome.Duplicate;
        if (
            await OverLimitAsync(
                context,
                address.Id,
                address.UserId,
                now,
                limits,
                cancellationToken
            )
        )
            return InboundAcceptOutcome.RateLimited;

        var id = RandomNumberGenerator.GetHexString(32, lowercase: true);
        var salt = InboundMailSealer.NewSalt();
        var nonce = InboundMailSealer.NewNonce();
        var path = InboundMailSealer.NewStoragePath();
        await sealer.WriteAsync(
            path,
            sealer.Seal(salt, nonce, delivery.Raw, RawPart, address.UserId, id),
            cancellationToken
        );
        try
        {
            context.InboundMessages.Add(
                new InboundMessage
                {
                    Id = id,
                    AddressId = address.Id,
                    UserId = address.UserId,
                    ReceivedAt = now,
                    SizeBytes = delivery.Raw.LongLength,
                    Sha256 = sha256,
                    Status = "pending",
                    DueAt = now,
                    StoragePath = path,
                    KeySalt = salt,
                    FileNonce = nonce,
                }
            );
            await using var transaction = await context.Database.BeginTransactionAsync(
                CancellationToken.None
            );
            // Not cancellable: once the file is in place, the outcome must be known.
            await context.SaveChangesAsync(CancellationToken.None);
            await context
                .ReceiptMailAddresses.Where(row => row.Id == address.Id)
                .ExecuteUpdateAsync(
                    update => update.SetProperty(row => row.LastReceivedAt, now),
                    CancellationToken.None
                );
            await transaction.CommitAsync(CancellationToken.None);
            return InboundAcceptOutcome.Accepted;
        }
        catch (DbUpdateException error) when (IsUniqueViolation(error))
        {
            // The same message arrived twice at once; the other copy was stored.
            sealer.Delete(path);
            return InboundAcceptOutcome.Duplicate;
        }
        catch (Exception error)
            when (error is PostgresException
                || error is DbUpdateException { InnerException: PostgresException }
            )
        {
            sealer.Delete(path);
            throw;
        }
    }

    private static async Task<bool> OverLimitAsync(
        PennyDbContext context,
        string addressId,
        string userId,
        DateTimeOffset now,
        InboundMailSettings limits,
        CancellationToken cancellationToken
    )
    {
        var hourAgo = now.AddHours(-1);
        var dayAgo = now.AddDays(-1);
        var recent = await context
            .InboundMessages.Where(message =>
                message.AddressId == addressId && message.ReceivedAt > dayAgo
            )
            .GroupBy(_ => 1)
            .Select(group => new
            {
                Day = group.Count(),
                Hour = group.Count(message => message.ReceivedAt > hourAgo),
            })
            .SingleOrDefaultAsync(cancellationToken);
        if (
            recent is not null
            && (recent.Hour >= limits.HourlyLimit || recent.Day >= limits.DailyLimit)
        )
            return true;
        var waiting = await context.InboundMessages.CountAsync(
            message => message.UserId == userId && Waiting.Contains(message.Status),
            cancellationToken
        );
        var unhandled = await context.ReceiptInboxItems.CountAsync(
            item => item.UserId == userId && Unhandled.Contains(item.Status),
            cancellationToken
        );
        if (waiting + unhandled >= limits.MaxPendingPerUser)
            return true;
        return await context.InboundMessages.CountAsync(
                message => Waiting.Contains(message.Status),
                cancellationToken
            ) >= limits.MaxPendingTotal;
    }

    private static bool IsUniqueViolation(DbUpdateException error) =>
        error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };

    private static IQueryable<ReceiptMailAddress> Live(
        PennyDbContext context,
        DateTimeOffset now
    ) =>
        context.ReceiptMailAddresses.Where(address =>
            address.RevokedAt == null && address.ExpiresAt > now
        );

    private ReceiptMailAddress Seal(
        string userId,
        string id,
        string address,
        string localPartHash,
        IReadOnlyList<string> senders,
        DateTimeOffset createdAt,
        DateTimeOffset expiresAt
    )
    {
        var salt = InboundMailSealer.NewSalt();
        var addressNonce = InboundMailSealer.NewNonce();
        var sendersNonce = InboundMailSealer.NewNonce();
        return new ReceiptMailAddress
        {
            Id = id,
            UserId = userId,
            LocalPartHash = localPartHash,
            KeySalt = salt,
            AddressNonce = addressNonce,
            AddressEncrypted = sealer.SealText(
                salt,
                addressNonce,
                address,
                AddressPart,
                userId,
                id
            ),
            AllowedSendersNonce = sendersNonce,
            AllowedSendersEncrypted = sealer.SealText(
                salt,
                sendersNonce,
                JsonSerializer.Serialize(senders),
                SendersPart,
                userId,
                id
            ),
            CreatedAt = createdAt,
            ExpiresAt = expiresAt,
        };
    }

    private StoredMailAddress Open(ReceiptMailAddress row) =>
        new(
            row.Id,
            sealer.OpenText(
                row.EncryptionVersion,
                row.KeySalt,
                row.AddressNonce,
                row.AddressEncrypted,
                AddressPart,
                row.UserId,
                row.Id
            ),
            row.CreatedAt,
            row.ExpiresAt,
            row.LastReceivedAt,
            JsonSerializer.Deserialize<string[]>(
                sealer.OpenText(
                    row.EncryptionVersion,
                    row.KeySalt,
                    row.AllowedSendersNonce,
                    row.AllowedSendersEncrypted,
                    SendersPart,
                    row.UserId,
                    row.Id
                )
            ) ?? []
        );
}
