namespace Penny.Backend.Application.Push;

// What the repository stores for one sent delivery. `TicketId` is the provider's id
// for an accepted message (the APNs `apns-id`); `RetryAt` is set for retries.
public sealed record PushDeliveryResult(
    string Token,
    PushOutcomeKind Kind,
    string? Reason,
    string? TicketId,
    DateTimeOffset? RetryAt
);
