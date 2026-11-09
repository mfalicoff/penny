namespace Penny.Backend.Application.Abstractions.Persistence;

// A household audit row. `BeforeJson`/`AfterJson` are JSON text (stored as jsonb).
public sealed record StoredAuditEvent(
    string Id,
    string HouseholdId,
    string ActorId,
    string Action,
    string? BeforeJson,
    string? AfterJson,
    DateTimeOffset CreatedAt
);
