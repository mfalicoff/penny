using Penny.Backend.Api.ClientTelemetry;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Observability;

// MAZ-129: the server's copy of apps/web/src/telemetry/scrub.ts gives the same answers.
public sealed class TelemetryScrubberTests
{
    [Theory]
    [InlineData(
        "https://penny.example.com/households/3f2b9c1e-7a1d?q=rent#x",
        "https://penny.example.com/households/:id"
    )]
    [InlineData("/api/v1/search?q=groceries", "/api/v1/search")]
    [InlineData("/reset-password#code=abc", "/reset-password")]
    [InlineData(
        "https://penny.example.com/assets/index-Bx3a9.js",
        "https://penny.example.com/assets/index-Bx3a9.js"
    )]
    [InlineData(
        "https://penny.example.com/entries/deadbeefcafe",
        "https://penny.example.com/entries/:id"
    )]
    [InlineData("https://user:pw@penny.example.com/settings", "https://penny.example.com/settings")]
    [InlineData("TypeError", "TypeError")]
    public void whenValueIsUrl_ScrubUrl_ShouldKeepOnlyThePathShape(string value, string expected) =>
        TelemetryScrubber.ScrubUrl(value).ShouldBe(expected);

    [Theory]
    [InlineData("Cannot read \"Rent\" of 1,450.00", "Cannot read <text> of <n>")]
    [InlineData("Invite sent to alex@example.com", "Invite sent to <email>")]
    [InlineData(
        "Failed https://penny.example.com/households/42?q=x",
        "Failed https://penny.example.com/households/:id"
    )]
    [InlineData("Bad link /reset-password#code=abc123", "Bad link /reset-password#code=<code>")]
    [InlineData("Network error", "Network error")]
    public void whenTextHasUserContent_ScrubText_ShouldRedactIt(string value, string expected) =>
        TelemetryScrubber.ScrubText(value).ShouldBe(expected);

    [Fact]
    public void whenTextIsVisible_Mask_ShouldHideEveryCharacterButWhitespace() =>
        TelemetryScrubber.Mask("Rent $1,450\nPaid").ShouldBe("**** ******\n****");
}
