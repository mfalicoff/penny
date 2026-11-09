using System.Text.Json.Serialization;
using Penny.Backend.Application.Search;

namespace Penny.Backend.Api.Contracts;

// Contract schema `SearchItem`: `entry` is an `Entry` for a personal result and a
// `ProjectedExpense` for a shared one. `match` is null for an empty query.
public sealed record SearchItemResponse(
    string Key,
    string Source,
    string? Match,
    [property: JsonPropertyName("entry")] object Entry
)
{
    public static SearchItemResponse From(SearchItemView item) =>
        new(
            item.Key,
            item.Source,
            item.Match,
            item.Entry is { } entry
                ? EntryResponse.From(entry)
                : ProjectedExpenseResponse.From(
                    item.Shared ?? throw new InvalidOperationException("Empty search item.")
                )
        );
}
