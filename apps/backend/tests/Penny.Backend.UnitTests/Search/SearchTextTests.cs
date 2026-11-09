using Penny.Backend.Domain.Search;
using Penny.Backend.UnitTests.Ledgers;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Search;

public sealed class SearchTextTests
{
    [Fact]
    public void whenSharedFixturesNormalized_Normalize_ShouldMatchEveryExpectedText()
    {
        var cases = ContractFixtures.Read("search-cases.json")["foldCases"]!.AsArray();
        cases.Count.ShouldBeGreaterThanOrEqualTo(20);
        foreach (var item in cases)
        {
            var expected = item!["expected"]!.GetValue<string>();
            SearchText
                .Normalize(item["input"]!.GetValue<string>())
                .ShouldBe(expected, item["name"]!.GetValue<string>());
            SearchText.Normalize(expected).ShouldBe(expected);
        }
    }

    [Fact]
    public void whenQueryHasWildcards_ContainsPattern_ShouldEscapeThemLiterally()
    {
        SearchText.ContainsPattern("100%_a\\b").ShouldBe("%100\\%\\_a\\\\b%");
        SearchText.ContainsPattern("").ShouldBe("%%");
    }

    [Fact]
    public void whenQueryInspected_TierPreconditions_ShouldCountCodePointsAndLetters()
    {
        SearchText.CodePoints("ab").ShouldBe(2);
        SearchText.CodePoints("a" + char.ConvertFromUtf32(0x1F389)).ShouldBe(2);
        SearchText.HasLetterOrDigit("%%%").ShouldBeFalse();
        SearchText.HasLetterOrDigit("% 7").ShouldBeTrue();
    }

    [Fact]
    public void whenDocumentBuilt_SearchDocumentText_ShouldKeepAccountsOutOfSharedAndEmbeddedText()
    {
        var text = SearchDocumentText.Build("Coffee  beans", "", "Food", "Travel Card");
        text.Title.ShouldBe("coffee beans");
        text.Document.ShouldBe("coffee beans food");
        text.OwnerDocument.ShouldBe("coffee beans food travel card");
        text.EmbeddingSource.ShouldBe("Coffee beans Food");
    }
}
