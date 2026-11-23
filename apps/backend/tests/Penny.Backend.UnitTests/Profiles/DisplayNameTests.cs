using Penny.Backend.Application.Profiles;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Profiles;

public sealed class DisplayNameTests
{
    [Theory]
    [InlineData("Ada", "Ada")]
    [InlineData("  Ada Lovelace\u00A0", "Ada Lovelace")]
    [InlineData("\uFEFFZoë", "Zoë")]
    public void whenNameIsValid_Normalize_ShouldReturnTrimmedName(string input, string expected) =>
        DisplayName.Normalize(input).ShouldBe(expected);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" \t ")]
    [InlineData("Tab\tinside")]
    [InlineData("Null\0")]
    [InlineData("Line\u2028separator")]
    [InlineData("Paragraph\u2029separator")]
    public void whenNameBreaksRules_Normalize_ShouldReturnNull(string? input) =>
        DisplayName.Normalize(input).ShouldBeNull();

    [Fact]
    public void whenNameLengthAtBoundary_Normalize_ShouldCountUtf16CodeUnits()
    {
        DisplayName.Normalize(new string('a', 60)).ShouldNotBeNull();
        DisplayName.Normalize(new string('a', 61)).ShouldBeNull();
        // An emoji is two code units, as in JavaScript.
        DisplayName.Normalize(new string('a', 58) + "😀").ShouldNotBeNull();
        DisplayName.Normalize(new string('a', 59) + "😀").ShouldBeNull();
    }

    [Theory]
    [InlineData("Grace Hopper", null, null, "Grace Hopper")]
    [InlineData(null, "Grace", "Hopper", "Grace Hopper")]
    [InlineData("  ", "Grace", null, "Grace")]
    [InlineData(null, null, "Hopper", "Hopper")]
    [InlineData("Grace\n\tHopper", null, null, "Grace Hopper")]
    [InlineData("\u0007\u0008", null, null, null)]
    [InlineData(null, null, null, null)]
    public void whenProviderSendsNameClaims_FromProvider_ShouldBuildDisplayName(
        string? name,
        string? given,
        string? family,
        string? expected
    ) => DisplayName.FromProvider(name, given, family).ShouldBe(expected);

    [Fact]
    public void whenProviderNameTooLong_FromProvider_ShouldCutWithoutSplittingSurrogates()
    {
        DisplayName.FromProvider(new string('a', 80), null, null).ShouldBe(new string('a', 60));
        var cut = DisplayName.FromProvider(new string('a', 59) + "😀b", null, null);
        cut.ShouldBe(new string('a', 59));
        DisplayName.Normalize(cut).ShouldBe(cut);
    }
}
