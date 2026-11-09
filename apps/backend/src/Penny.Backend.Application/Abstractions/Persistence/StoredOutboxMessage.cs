namespace Penny.Backend.Application.Abstractions.Persistence;

// A `push_outbox` row written in the same transaction as its audit event; the push
// worker (MAZ-61) delivers it after commit. `PayloadJson` is JSON text (jsonb).
public sealed record StoredOutboxMessage(
    string Id,
    string UserId,
    string HouseholdId,
    string EventType,
    string EntityId,
    string PayloadJson,
    DateTimeOffset CreatedAt
);
