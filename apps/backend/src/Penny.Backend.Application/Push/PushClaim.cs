namespace Penny.Backend.Application.Push;

// An outbox message leased to one runner pass.
public sealed record PushClaim(
    string OutboxId,
    string UserId,
    string EventType,
    string PayloadJson,
    DateTimeOffset CreatedAt
);
