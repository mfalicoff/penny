using System.Buffers.Text;
using System.Text;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Search;
using Penny.Backend.Domain.Search;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Search;

public sealed class SearchCursorTests
{
    private static readonly SearchRequest Request = new(
        "coffee",
        null,
        new DateOnly(2026, 11, 30),
        "expense",
        "all",
        "relevance",
        10,
        null
    );

    [Fact]
    public void whenCursorRoundTrips_Decode_ShouldRestoreTheSortTuple()
    {
        var hash = SearchCursor.Fingerprint(Request);
        var last = new SearchPosition(3, 712345, 0, new DateOnly(2026, 11, 2), "personal:a");
        SearchCursor
            .Decode(SearchCursor.Encode(hash, "relevance", last), hash, "relevance")
            .ShouldBe(last);
        var amount = new SearchPosition(0, 0, 500, new DateOnly(2026, 11, 2), "shared:b");
        SearchCursor
            .Decode(SearchCursor.Encode(hash, "amount-desc", amount), hash, "amount-desc")
            .ShouldBe(amount);
    }

    [Fact]
    public void whenRequestChanges_Fingerprint_ShouldChangeExceptForPageSize()
    {
        var hash = SearchCursor.Fingerprint(Request);
        SearchCursor.Fingerprint(Request with { PageSize = 99, Cursor = "x" }).ShouldBe(hash);
        foreach (
            var other in new[]
            {
                Request with
                {
                    Query = "coffees",
                },
                Request with
                {
                    From = new DateOnly(2026, 1, 1),
                },
                Request with
                {
                    To = null,
                },
                Request with
                {
                    Kind = null,
                },
                Request with
                {
                    Source = "personal",
                },
                Request with
                {
                    Sort = "date-desc",
                },
            }
        )
            SearchCursor.Fingerprint(other).ShouldNotBe(hash);
    }

    [Fact]
    public void whenCursorTamperedOrForeign_Decode_ShouldReturnNull()
    {
        var hash = SearchCursor.Fingerprint(Request);
        var cursor = SearchCursor.Encode(
            hash,
            "relevance",
            new SearchPosition(1, 1_000_000, 0, new DateOnly(2026, 11, 2), "personal:a")
        );
        SearchCursor
            .Decode(cursor, SearchCursor.Fingerprint(Request with { Query = "tea" }), "relevance")
            .ShouldBeNull();
        SearchCursor.Decode("%%%", hash, "relevance").ShouldBeNull();
        SearchCursor
            .Decode(Base64Url.EncodeToString(Encoding.UTF8.GetBytes("[1]")), hash, "relevance")
            .ShouldBeNull();
        var forged = Base64Url.EncodeToString(
            Encoding.UTF8.GetBytes(
                "{\"v\":1,\"h\":\""
                    + hash
                    + "\",\"d\":\"2026-11-02\",\"k\":\"personal:a\",\"t\":9,\"s\":0}"
            )
        );
        SearchCursor.Decode(forged, hash, "relevance").ShouldBeNull();
        var missingScore = Base64Url.EncodeToString(
            Encoding.UTF8.GetBytes(
                "{\"v\":1,\"h\":\"" + hash + "\",\"d\":\"2026-11-02\",\"k\":\"personal:a\"}"
            )
        );
        SearchCursor.Decode(missingScore, hash, "relevance").ShouldBeNull();
        SearchCursor.Decode(missingScore, hash, "date-desc").ShouldNotBeNull();
    }
}
