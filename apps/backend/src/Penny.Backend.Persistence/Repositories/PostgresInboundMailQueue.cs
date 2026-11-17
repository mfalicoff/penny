using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.InboundMail;
using Penny.Backend.Application.Push;
using Penny.Backend.Persistence.InboundMail;
using Penny.Backend.Persistence.Receipts;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;
using Penny.Backend.Persistence.Search;

namespace Penny.Backend.Persistence.Repositories;

// The leased inbound mail queue (MAZ-184). Claims follow the receipt text outbox:
// candidates by the partial due index, then a conditional update that re-checks the
// lease, so concurrent workers never share a message. Completion writes the receipt
// files first, then one transaction inserts the receipts (with their text extraction
// queued), the inbox item and its links and the owner's `receipt.received` push, and
// marks the message done, conditional on the lease. A worker that lost its lease changes nothing and its files are removed.
public sealed class PostgresInboundMailQueue(
    NpgsqlDataSource source,
    InboundMailSealer sealer,
    ReceiptFileStore receipts
) : IInboundMailQueue
{
    private const string RawPart = "raw";
    private const string SendersPart = "allowed-senders";
    private const string SubjectPart = "subject";
    private const string FromPart = "from";
    private static readonly string[] Waiting = ["pending", "processing"];

    public async Task<IReadOnlyList<InboundWork>> ClaimAsync(
        string leaseToken,
        DateTimeOffset now,
        DateTimeOffset leaseUntil,
        int limit,
        int maxAttempts,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        var candidates = await Due(context, now)
            .AsNoTracking()
            .Where(message => message.Attempts < maxAttempts)
            .OrderBy(message => message.DueAt)
            .ThenBy(message => message.Id)
            .Take(limit)
            .Select(message => message.Id)
            .ToListAsync(cancellationToken);
        if (candidates.Count == 0)
            return [];
        await Due(context, now)
            .Where(message => candidates.Contains(message.Id) && message.Attempts < maxAttempts)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(message => message.Status, "processing")
                        .SetProperty(message => message.LeaseToken, leaseToken)
                        .SetProperty(message => message.LeaseExpiresAt, leaseUntil)
                        .SetProperty(message => message.Attempts, message => message.Attempts + 1),
                cancellationToken
            );
        return await context
            .InboundMessages.AsNoTracking()
            .Where(message => candidates.Contains(message.Id) && message.LeaseToken == leaseToken)
            .OrderBy(message => message.Id)
            .Select(message => new InboundWork(
                message.Id,
                message.UserId,
                message.AddressId,
                message.ReceivedAt,
                message.DueAt!.Value,
                message.Attempts
            ))
            .ToListAsync(cancellationToken);
    }

    public async Task<OpenedMessage?> OpenAsync(
        InboundWork work,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        var row = await context
            .InboundMessages.AsNoTracking()
            .SingleOrDefaultAsync(message => message.Id == work.Id, cancellationToken);
        var address = await context
            .ReceiptMailAddresses.AsNoTracking()
            .SingleOrDefaultAsync(address => address.Id == work.AddressId, cancellationToken);
        if (row?.StoragePath is null || address is null)
            return null;
        try
        {
            var raw = sealer.Open(
                row.EncryptionVersion,
                row.KeySalt,
                row.FileNonce,
                await sealer.ReadAsync(row.StoragePath, cancellationToken),
                RawPart,
                row.UserId,
                row.Id
            );
            var senders = JsonSerializer.Deserialize<string[]>(
                sealer.OpenText(
                    address.EncryptionVersion,
                    address.KeySalt,
                    address.AllowedSendersNonce,
                    address.AllowedSendersEncrypted,
                    SendersPart,
                    address.UserId,
                    address.Id
                )
            ) ?? [];
            return new OpenedMessage(raw, senders);
        }
        catch (Exception error)
            when (error
                    is FileNotFoundException
                        or DirectoryNotFoundException
                        or CryptographicException
            )
        {
            return null;
        }
    }

    public async Task<bool> CompleteAsync(
        InboundWork work,
        string leaseToken,
        MailConversion conversion,
        DateTimeOffset now,
        DateTimeOffset inboxExpiresAt,
        CancellationToken cancellationToken
    )
    {
        var written = new List<EncryptedReceipt>();
        try
        {
            foreach (var receipt in conversion.Receipts)
            {
                var encrypted = receipts.Encrypt(
                    work.UserId,
                    RandomNumberGenerator.GetHexString(32, lowercase: true),
                    receipt.Name,
                    receipt.Mime,
                    receipt.Content,
                    now
                );
                await receipts.WriteAsync(encrypted, cancellationToken);
                written.Add(encrypted);
            }
            string? rawPath;
            await using (var context = PennyDbContext.Create(source))
            {
                await using var transaction = await context.Database.BeginTransactionAsync(
                    CancellationToken.None
                );
                rawPath = await context
                    .InboundMessages.Where(message =>
                        message.Id == work.Id && message.LeaseToken == leaseToken
                    )
                    .Select(message => message.StoragePath)
                    .SingleOrDefaultAsync(CancellationToken.None);
                var marked = await Leased(context, work, leaseToken)
                    .ExecuteUpdateAsync(
                        set =>
                            set.SetProperty(message => message.Status, "done")
                                .SetProperty(message => message.ReasonCode, (string?)null)
                                .SetProperty(
                                    message => message.AuthSpf,
                                    conversion.Authentication.Spf
                                )
                                .SetProperty(
                                    message => message.AuthDkim,
                                    conversion.Authentication.Dkim
                                )
                                .SetProperty(
                                    message => message.AuthDmarc,
                                    conversion.Authentication.Dmarc
                                )
                                .SetProperty(message => message.ProcessedAt, now)
                                .SetProperty(message => message.StoragePath, (string?)null)
                                .SetProperty(message => message.DueAt, (DateTimeOffset?)null)
                                .SetProperty(message => message.LeaseToken, (string?)null)
                                .SetProperty(
                                    message => message.LeaseExpiresAt,
                                    (DateTimeOffset?)null
                                ),
                        CancellationToken.None
                    );
                if (marked != 1)
                {
                    DeleteFiles(written);
                    return false;
                }
                var item = InboxItem(work, conversion, now, inboxExpiresAt);
                context.Receipts.AddRange(written.Select(receipt => receipt.Row));
                context.ReceiptTexts.AddRange(
                    written.Select(receipt => ReceiptTextIndex.Pending(receipt.Row.Id))
                );
                context.ReceiptInboxItems.Add(item);
                context.ReceiptInboxReceipts.AddRange(
                    written.Select(
                        (receipt, position) =>
                            new ReceiptInboxReceipt
                            {
                                InboxItemId = item.Id,
                                ReceiptId = receipt.Row.Id,
                                UserId = work.UserId,
                                Kind = conversion.Receipts[position].Kind,
                                Position = position,
                            }
                    )
                );
                await AddReceivedPushAsync(context, item, now);
                // Not cancellable: once the files are in place, the outcome must be known.
                await context.SaveChangesAsync(CancellationToken.None);
                await transaction.CommitAsync(CancellationToken.None);
            }
            DeleteRaw(rawPath);
            return true;
        }
        catch (Exception error)
            when (error is PostgresException
                || error is DbUpdateException { InnerException: PostgresException }
            )
        {
            DeleteFiles(written);
            throw;
        }
    }

    public async Task<bool> FinishAsync(
        InboundWork work,
        string leaseToken,
        string status,
        string reason,
        MailAuthentication? authentication,
        DateTimeOffset now,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        return await Leased(context, work, leaseToken)
                .ExecuteUpdateAsync(
                    set =>
                        set.SetProperty(message => message.Status, status)
                            .SetProperty(message => message.ReasonCode, reason)
                            .SetProperty(
                                message => message.AuthSpf,
                                authentication == null ? null : authentication.Spf
                            )
                            .SetProperty(
                                message => message.AuthDkim,
                                authentication == null ? null : authentication.Dkim
                            )
                            .SetProperty(
                                message => message.AuthDmarc,
                                authentication == null ? null : authentication.Dmarc
                            )
                            .SetProperty(message => message.ProcessedAt, now)
                            .SetProperty(message => message.DueAt, (DateTimeOffset?)null)
                            .SetProperty(message => message.LeaseToken, (string?)null)
                            .SetProperty(message => message.LeaseExpiresAt, (DateTimeOffset?)null),
                    cancellationToken
                ) == 1;
    }

    public async Task<(long Waiting, long Unhandled)> BacklogAsync(
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        var waiting = await context.InboundMessages.LongCountAsync(
            message => Waiting.Contains(message.Status),
            cancellationToken
        );
        var unhandled = await context.ReceiptInboxItems.LongCountAsync(
            item => item.Status == "to_attach" || item.Status == "partly_attached",
            cancellationToken
        );
        return (waiting, unhandled);
    }

    public async Task<bool> RetryAsync(
        InboundWork work,
        string leaseToken,
        DateTimeOffset dueAt,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        return await Leased(context, work, leaseToken)
                .ExecuteUpdateAsync(
                    set =>
                        set.SetProperty(message => message.Status, "pending")
                            .SetProperty(message => message.DueAt, dueAt)
                            .SetProperty(message => message.LeaseToken, (string?)null)
                            .SetProperty(message => message.LeaseExpiresAt, (DateTimeOffset?)null),
                    cancellationToken
                ) == 1;
    }

    public async Task<int> SweepAsync(
        DateTimeOffset now,
        TimeSpan rawRetention,
        int maxAttempts,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        // A message whose last allowed attempt was claimed and never finished: its worker
        // died during it (perhaps because of it). It is failed, not tried again.
        var changed = await Due(context, now)
            .Where(message => message.Attempts >= maxAttempts)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(message => message.Status, "failed")
                        .SetProperty(message => message.ReasonCode, MailRejectReason.LeaseExpired)
                        .SetProperty(message => message.ProcessedAt, now)
                        .SetProperty(message => message.DueAt, (DateTimeOffset?)null)
                        .SetProperty(message => message.LeaseToken, (string?)null)
                        .SetProperty(message => message.LeaseExpiresAt, (DateTimeOffset?)null),
                cancellationToken
            );
        var cutoff = now - rawRetention;
        var expired = await context
            .InboundMessages.AsNoTracking()
            .Where(message =>
                message.StoragePath != null
                && (message.Status == "rejected" || message.Status == "failed")
                && message.ProcessedAt < cutoff
            )
            .OrderBy(message => message.ProcessedAt)
            .Take(500)
            .Select(message => new { message.Id, message.StoragePath })
            .ToListAsync(cancellationToken);
        foreach (var message in expired)
        {
            var cleared = await context
                .InboundMessages.Where(row =>
                    row.Id == message.Id && row.StoragePath == message.StoragePath
                )
                .ExecuteUpdateAsync(
                    set => set.SetProperty(row => row.StoragePath, (string?)null),
                    cancellationToken
                );
            if (cleared == 1)
            {
                DeleteRaw(message.StoragePath);
                changed++;
            }
        }
        return changed;
    }

    private static IQueryable<InboundMessage> Due(PennyDbContext context, DateTimeOffset now) =>
        context.InboundMessages.Where(message =>
            Waiting.Contains(message.Status)
            && message.DueAt != null
            && message.DueAt <= now
            && (message.LeaseExpiresAt == null || message.LeaseExpiresAt <= now)
        );

    private static IQueryable<InboundMessage> Leased(
        PennyDbContext context,
        InboundWork work,
        string leaseToken
    ) =>
        context.InboundMessages.Where(message =>
            message.Id == work.Id && message.LeaseToken == leaseToken
        );

    // The owner's "New receipt" notification, in the transaction that creates the item,
    // when the owner has a registered device (the delivery worker sends only to devices
    // with a live session). Personal: no household; the payload is the inbox link only.
    private static async Task AddReceivedPushAsync(
        PennyDbContext context,
        ReceiptInboxItem item,
        DateTimeOffset now
    )
    {
        if (
            !await context.PushDevices.AnyAsync(
                device => device.UserId == item.UserId,
                CancellationToken.None
            )
        )
            return;
        var id = RandomNumberGenerator.GetHexString(32, lowercase: true);
        context.PushOutbox.Add(
            new PushOutboxMessage
            {
                Id = id,
                UserId = item.UserId,
                HouseholdId = null,
                EventType = PushContent.ReceiptReceived,
                EntityId = item.Id,
                Payload = new ReceiptInboxPushPayload(item.Id, id).ToJson(),
                CreatedAt = now,
                NextAttemptAt = now,
            }
        );
    }

    private ReceiptInboxItem InboxItem(
        InboundWork work,
        MailConversion conversion,
        DateTimeOffset now,
        DateTimeOffset expiresAt
    )
    {
        var id = RandomNumberGenerator.GetHexString(32, lowercase: true);
        var salt = InboundMailSealer.NewSalt();
        var subjectNonce = InboundMailSealer.NewNonce();
        var fromNonce = InboundMailSealer.NewNonce();
        return new ReceiptInboxItem
        {
            Id = id,
            UserId = work.UserId,
            InboundMessageId = work.Id,
            KeySalt = salt,
            SubjectNonce = subjectNonce,
            SubjectEncrypted = sealer.SealText(
                salt,
                subjectNonce,
                conversion.Subject,
                SubjectPart,
                work.UserId,
                id
            ),
            FromNonce = fromNonce,
            FromEncrypted = sealer.SealText(
                salt,
                fromNonce,
                conversion.From,
                FromPart,
                work.UserId,
                id
            ),
            SenderVerified = conversion.Authentication.Verified,
            ReceivedAt = work.ReceivedAt,
            Status = "to_attach",
            ExpiresAt = expiresAt,
        };
    }

    private void DeleteRaw(string? storagePath)
    {
        if (storagePath is null)
            return;
        try
        {
            sealer.Delete(storagePath);
        }
        catch (IOException)
        {
            // The row no longer references it; a later maintenance sweep can remove it.
        }
    }

    private void DeleteFiles(IEnumerable<EncryptedReceipt> written)
    {
        foreach (var receipt in written)
            receipts.Delete(receipt.Row.StoragePath);
    }
}
