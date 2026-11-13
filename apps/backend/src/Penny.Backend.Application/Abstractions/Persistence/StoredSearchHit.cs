namespace Penny.Backend.Application.Abstractions.Persistence;

// One authorized result with its sort tuple. Personal hits carry `Entry`; shared hits
// carry `Expense` and the viewer's share (0 for a current member without a share).
// `Tier` is 0 for an empty query (no match tier), otherwise 1 (title) to 4 (meaning).
public sealed record StoredSearchHit(
    string Key,
    int Tier,
    long Score,
    long Amount,
    DateOnly Date,
    StoredEntry? Entry,
    StoredProjectedExpense? Expense,
    long ShareCents
);
