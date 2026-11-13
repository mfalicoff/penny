namespace Penny.Backend.Domain.Search;

// A validated `POST /api/v1/search/transactions` body. `Query` is the normalized
// query (empty matches everything that passes the filters); `Kind` null means every
// kind; `Sort` is the effective sort (relevance only with a non-empty query).
public sealed record SearchRequest(
    string Query,
    DateOnly? From,
    DateOnly? To,
    string? Kind,
    string Source,
    string Sort,
    int PageSize,
    string? Cursor
);
