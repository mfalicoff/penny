namespace Penny.Backend.Application.Abstractions.Persistence;

// A household audit row. `BeforeJson`/`AfterJson` are JSON text (stored as jsonb);
// `ExpenseId` links expense and payment events to their expense.
public sealed record StoredAuditEvent(
    string Id,
    string HouseholdId,
    string ActorId,
    string Action,
    string? BeforeJson,
    string? AfterJson,
    DateTimeOffset CreatedAt,
    string? ExpenseId = null
);
