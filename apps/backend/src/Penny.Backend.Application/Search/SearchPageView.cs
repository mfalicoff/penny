namespace Penny.Backend.Application.Search;

public sealed record SearchPageView(
    IReadOnlyList<SearchItemView> Items,
    long TotalCount,
    string? NextCursor
);
