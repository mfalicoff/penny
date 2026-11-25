namespace Penny.Backend.Application.Households;

// One household audit event. `BeforeJson`/`AfterJson` are the stored
// JSON snapshots, which never hold private data (null when absent); `CreatedAt` is
// Unix milliseconds.
public sealed record AuditEventView(
    string Id,
    string HouseholdId,
    string? ExpenseId,
    string ActorId,
    string Action,
    string? BeforeJson,
    string? AfterJson,
    long CreatedAt
);
