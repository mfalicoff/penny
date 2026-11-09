using System.Text.Json;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Abstractions.Search;
using Penny.Backend.Application.Households;
using Penny.Backend.Application.Ledgers;
using Penny.Backend.Domain.Errors;
using Penny.Backend.Domain.Search;

namespace Penny.Backend.Application.Search;

// POST /api/v1/search/transactions (docs/migration/search.md). The viewer is always
// the session's user. Authorization, matching, counting and paging run in one SQL
// snapshot; this service validates the request, embeds the query and builds cursors.
// Search text is never logged.
public sealed class SearchService(ISearchRepository search, ITextEmbedder embedder)
{
    private static readonly string[] Matches = ["", "title", "text", "typo", "meaning"];

    public async Task<SearchPageView> SearchAsync(
        string viewerId,
        JsonElement? body,
        CancellationToken cancellationToken
    )
    {
        var request = SearchReader.Read(body);
        var fingerprint = SearchCursor.Fingerprint(request);
        SearchPosition? after = null;
        if (request.Cursor is { } cursor)
            after =
                SearchCursor.Decode(cursor, fingerprint, request.Sort)
                ?? throw new BackendFailure(FailureKind.Invalid, SearchCursor.Invalid);
        // The meaning tier needs a query with a letter or digit.
        var vector = SearchText.HasLetterOrDigit(request.Query)
            ? embedder.EmbedQuery(request.Query)
            : null;
        var page = await search.SearchAsync(
            new SearchCriteria(
                viewerId,
                request,
                after,
                request.PageSize + 1,
                vector,
                embedder.ModelId
            ),
            cancellationToken
        );
        var hits = page.Hits.Take(request.PageSize).ToList();
        var next =
            page.Hits.Count > request.PageSize
                ? SearchCursor.Encode(fingerprint, request.Sort, Position(hits[^1]))
                : null;
        return new(
            [.. hits.Select(hit => Item(hit, viewerId, page.Receipts))],
            page.TotalCount,
            next
        );
    }

    private static SearchPosition Position(StoredSearchHit hit) =>
        new(hit.Tier, hit.Score, hit.Amount, hit.Date, hit.Key);

    private static SearchItemView Item(
        StoredSearchHit hit,
        string viewerId,
        IReadOnlyDictionary<string, StoredReceiptInfo> receipts
    )
    {
        var match = hit.Tier == 0 ? null : Matches[hit.Tier];
        if (hit.Entry is { } entry)
            return new(
                hit.Key,
                SearchReader.Personal,
                match,
                LedgerMapper.ToEntry(entry, receipts),
                null
            );
        var expense =
            hit.Expense ?? throw new InvalidOperationException("A search hit has no result.");
        return new(
            hit.Key,
            SearchReader.Shared,
            match,
            null,
            ProjectedExpenseView.Recorded(expense, viewerId, hit.ShareCents)
        );
    }
}
