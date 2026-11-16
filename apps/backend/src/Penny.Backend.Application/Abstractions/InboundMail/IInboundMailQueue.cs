namespace Penny.Backend.Application.Abstractions.InboundMail;

// The leased queue of inbound messages (MAZ-184). Every write after the claim is
// conditional on the lease token, so a worker whose lease expired changes nothing.
public interface IInboundMailQueue
{
    Task<IReadOnlyList<InboundWork>> ClaimAsync(
        string leaseToken,
        DateTimeOffset now,
        DateTimeOffset leaseUntil,
        int limit,
        int maxAttempts,
        CancellationToken cancellationToken
    );

    // Null when the raw file is gone or cannot be opened.
    Task<OpenedMessage?> OpenAsync(InboundWork work, CancellationToken cancellationToken);

    // Stores the receipts (queueing their text extraction), the inbox item and its
    // links, marks the message done and deletes the raw file, all or nothing.
    Task<bool> CompleteAsync(
        InboundWork work,
        string leaseToken,
        MailConversion conversion,
        DateTimeOffset now,
        DateTimeOffset inboxExpiresAt,
        CancellationToken cancellationToken
    );

    // `rejected` (the message itself was refused) or `failed` (it could not be
    // processed). The raw file is kept for diagnosis until the sweep.
    Task<bool> FinishAsync(
        InboundWork work,
        string leaseToken,
        string status,
        string reason,
        MailAuthentication? authentication,
        DateTimeOffset now,
        CancellationToken cancellationToken
    );

    // Messages waiting to be converted and unhandled inbox items, for the backlog gauges.
    Task<(long Waiting, long Unhandled)> BacklogAsync(CancellationToken cancellationToken);

    Task<bool> RetryAsync(
        InboundWork work,
        string leaseToken,
        DateTimeOffset dueAt,
        CancellationToken cancellationToken
    );

    // Deletes raw files of rejected and failed messages older than `rawRetention`, and
    // fails due messages that used every attempt. Returns how many rows changed.
    Task<int> SweepAsync(
        DateTimeOffset now,
        TimeSpan rawRetention,
        int maxAttempts,
        CancellationToken cancellationToken
    );
}
