namespace Penny.Backend.Application.Push;

// What the repository stores for one sent delivery. `RetryAt` is set for retries;
// `AwaitReceipt` keeps an accepted Expo ticket open for its receipt check.
public sealed record PushDeliveryResult(
    string Token,
    PushOutcomeKind Kind,
    string? Reason,
    string? TicketId,
    DateTimeOffset? RetryAt,
    bool AwaitReceipt
);
