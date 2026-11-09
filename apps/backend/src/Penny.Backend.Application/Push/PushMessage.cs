namespace Penny.Backend.Application.Push;

// A rendered household notification for one device. `Environment` is the APNs
// gateway (null for Expo). `ExpiresAt` bounds provider-side storage; `CollapseId`
// (the outbox id) lets the device replace an at-least-once duplicate.
public sealed record PushMessage(
    string OutboxId,
    string Token,
    string? Environment,
    string Title,
    string Body,
    PushPayload Payload,
    DateTimeOffset ExpiresAt
)
{
    public string CollapseId => OutboxId;
}
