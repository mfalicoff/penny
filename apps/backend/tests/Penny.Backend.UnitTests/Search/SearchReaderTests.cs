using System.Text.Json;
using Penny.Backend.Domain.Errors;
using Penny.Backend.Domain.Search;
using Penny.Backend.UnitTests.Ledgers;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Search;

public sealed class SearchReaderTests
{
    private static SearchRequest Read(string json)
    {
        using var document = JsonDocument.Parse(json);
        return SearchReader.Read(document.RootElement.Clone());
    }

    [Fact]
    public void whenFieldsOmitted_Read_ShouldApplyDefaults()
    {
        var request = Read("{}");
        request.ShouldBe(new SearchRequest("", null, null, null, "all", "date-desc", 50, null));
        Read("""{"query":"  Café "}""").Sort.ShouldBe("relevance");
        Read("""{"query":"  Café "}""").Query.ShouldBe("cafe");
        Read("""{"query":" ","sort":"relevance"}""").Sort.ShouldBe("date-desc");
        Read(
                """{"query":"a","sort":"amount-asc","pageSize":100,"from":"2026-01-01","to":"2026-01-01"}"""
            )
            .ShouldBe(
                new SearchRequest(
                    "a",
                    new DateOnly(2026, 1, 1),
                    new DateOnly(2026, 1, 1),
                    null,
                    "all",
                    "amount-asc",
                    100,
                    null
                )
            );
    }

    [Fact]
    public void whenFixtureRequestsRead_Read_ShouldAcceptValidAndRejectInvalid()
    {
        var fixture = ContractFixtures.Read("search-cases.json");
        foreach (var item in fixture["requests"]!.AsArray())
            Should.NotThrow(() => Read(item!.ToJsonString()));
        foreach (var item in fixture["invalidRequests"]!.AsArray())
            Should
                .Throw<BackendFailure>(() => Read(item!.ToJsonString()), item!.ToJsonString())
                .Kind.ShouldBe(FailureKind.Invalid);
        Should.Throw<BackendFailure>(() => SearchReader.Read(null));
        Should.Throw<BackendFailure>(() => Read("[]"));
        // 200 UTF-16 units after trimming; surrogate pairs count twice.
        Read(JsonSerializer.Serialize(new { query = "  " + new string('x', 200) + "  " }))
            .Query.Length.ShouldBe(200);
        Should.Throw<BackendFailure>(() =>
            Read(
                JsonSerializer.Serialize(
                    new
                    {
                        query = string.Concat(
                            Enumerable.Repeat(char.ConvertFromUtf32(0x1F389), 101)
                        ),
                    }
                )
            )
        );
        Should.Throw<BackendFailure>(() => Read("""{"query":"\ud800"}"""));
    }
}
