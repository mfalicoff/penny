namespace Penny.Backend.Application.Abstractions.Persistence;

// Up to `Limit` hits in sort order, the authorized match count and the names of the
// viewer's receipts linked by personal hits.
public sealed record StoredSearchPage(
    long TotalCount,
    IReadOnlyList<StoredSearchHit> Hits,
    IReadOnlyDictionary<string, StoredReceiptInfo> Receipts
);
