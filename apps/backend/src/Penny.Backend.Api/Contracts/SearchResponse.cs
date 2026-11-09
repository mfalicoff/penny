using Penny.Backend.Application.Search;

namespace Penny.Backend.Api.Contracts;

// Contract schema `SearchResponse` (search v1).
public sealed record SearchResponse(
    int Version,
    IReadOnlyList<SearchItemResponse> Items,
    long TotalCount,
    string? NextCursor
)
{
    public static SearchResponse From(SearchPageView page) =>
        new(1, [.. page.Items.Select(SearchItemResponse.From)], page.TotalCount, page.NextCursor);
}
