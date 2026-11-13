using System.Text.Json;
using Penny.Backend.Domain.Households;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Households;

// Accept/reject cases of the household request readers.
public sealed class HouseholdReaderTests
{
    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();

    [Fact]
    public void whenHouseholdBodyValid_ReadNew_ShouldTrimNameAndKeepOffset()
    {
        var input = HouseholdReader.ReadNew(
            Json("""{"name":" Home ","currency":"CAD","timezoneOffsetMinutes":2.4e2,"extra":1}"""),
            trip: false
        )!;
        input.ShouldBe(new NewHousehold("Home", "CAD", 240, null));
        HouseholdReader
            .ReadNew(
                Json(
                    """{"name":"Coast","currency":"EUR","startDate":"2024-02-29","endDate":"2024-02-29"}"""
                ),
                trip: true
            )!
            .Trip.ShouldBe(new TripDates(new(2024, 2, 29), new(2024, 2, 29)));
        // A household body ignores trip dates entirely.
        HouseholdReader
            .ReadNew(Json("""{"name":"Home","currency":"GBP","startDate":"nope"}"""), trip: false)!
            .Trip.ShouldBeNull();
    }

    [Theory]
    [InlineData("""{"name":"","currency":"CAD"}""")]
    [InlineData("""{"name":"   ","currency":"CAD"}""")]
    [InlineData("""{"name":null,"currency":"CAD"}""")]
    [InlineData("""{"name":"Home"}""")]
    [InlineData("""{"name":"Home","currency":"JPY"}""")]
    [InlineData("""{"name":"Home","currency":"CAD","timezoneOffsetMinutes":null}""")]
    [InlineData("""{"name":"Home","currency":"CAD","timezoneOffsetMinutes":"240"}""")]
    [InlineData("""{"name":"Home","currency":"CAD","timezoneOffsetMinutes":-841}""")]
    [InlineData("""{"name":"Home","currency":"CAD","timezoneOffsetMinutes":0.5}""")]
    [InlineData("""["Home"]""")]
    public void whenHouseholdBodyInvalid_ReadNew_ShouldReturnNull(string body) =>
        HouseholdReader.ReadNew(Json(body), trip: false).ShouldBeNull();

    [Fact]
    public void whenNameLengthAtBoundary_ReadName_ShouldCountUtf16UnitsAfterTrimming()
    {
        var eighty = new string('a', 80);
        HouseholdReader.ReadName(Json($$"""{"name":"  {{eighty}}  "}""")).ShouldBe(eighty);
        HouseholdReader.ReadName(Json($$"""{"name":"{{eighty}}a"}""")).ShouldBeNull();
        // 40 surrogate pairs are 80 UTF-16 units.
        var pairs = string.Concat(Enumerable.Repeat("😀", 40));
        HouseholdReader.ReadName(Json($$"""{"name":"{{pairs}}"}""")).ShouldBe(pairs);
        HouseholdReader.ReadName(Json($$"""{"name":"{{pairs}}a"}""")).ShouldBeNull();
        HouseholdReader.ReadName(null).ShouldBeNull();
    }

    [Theory]
    [InlineData("2026-11-08", "2026-11-07")]
    [InlineData("1999-12-31", "2000-01-01")]
    [InlineData("2100-12-31", "2101-01-01")]
    [InlineData("2026-02-29", "2026-03-01")]
    [InlineData("2026-1-01", "2026-01-02")]
    public void whenTripDatesInvalid_ReadTrip_ShouldReturnNull(string start, string end) =>
        HouseholdReader
            .ReadTrip(Json($$"""{"name":"Coast","startDate":"{{start}}","endDate":"{{end}}"}"""))
            .ShouldBeNull();

    [Theory]
    [InlineData("""{"code":"abcdef0123"}""", "ABCDEF0123", null)]
    [InlineData("""{"code":"ABCDEF0123","timezoneOffsetMinutes":720}""", "ABCDEF0123", 720)]
    public void whenCodeWellFormed_ReadJoin_ShouldUpperCaseIt(
        string body,
        string code,
        int? offset
    ) => HouseholdReader.ReadJoin(Json(body)).ShouldBe(new JoinRequest(code, offset));

    [Theory]
    [InlineData("""{"code":"ABCDEF012"}""")]
    [InlineData("""{"code":"ABCDEF01234"}""")]
    [InlineData("""{"code":"ABCDEF012G"}""")]
    [InlineData("""{"code":"ABCDEF012\n"}""")]
    [InlineData("""{"code":1234567890}""")]
    [InlineData("""{}""")]
    public void whenCodeMalformed_ReadJoin_ShouldReturnNull(string body) =>
        HouseholdReader.ReadJoin(Json(body)).ShouldBeNull();
}
