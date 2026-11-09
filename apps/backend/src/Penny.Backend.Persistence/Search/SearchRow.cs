namespace Penny.Backend.Persistence.Search;

// One matched, authorized document with its sort tuple, as SQL computes it. `Amount`
// is the viewer's share in cents; `Tier` 0 means an empty query (no tier).
internal sealed class SearchRow
{
    public long Id { get; init; }
    public required string Key { get; init; }
    public required string Source { get; init; }
    public string? EntryId { get; init; }
    public string? ExpenseId { get; init; }
    public DateOnly Date { get; init; }
    public long Amount { get; init; }
    public int Tier { get; init; }
    public long Score { get; init; }
}
