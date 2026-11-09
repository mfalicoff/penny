using Penny.Backend.Domain.Search;

namespace Penny.Backend.Persistence.Search;

// The search document a source row should have, computed from that row alone.
internal sealed record ExpectedDocument(
    string Source,
    string ResultKey,
    string? UserId,
    string? EntryId,
    string? ExpenseId,
    string? HouseholdId,
    string? PayerId,
    string Kind,
    DateOnly ItemDate,
    long? AmountCents,
    SearchDocumentText Text
);
