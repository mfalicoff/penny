using Penny.Backend.Application.Receipts;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Receipts;

public sealed class ReceiptTextCleanerTests
{
    [Fact]
    public void whenEngineOutputIsRagged_Clean_ShouldCollapseSpacesAndDropEmptyLines()
    {
        ReceiptTextCleaner
            .Clean("  STORE   NAME \r\n\n\tMilk\t\t2.99  \f\fTOTAL 2.99\n\n", 1000)
            .ShouldBe("STORE NAME\nMilk 2.99\nTOTAL 2.99");
    }

    [Fact]
    public void whenTextHasUnstorableCharacters_Clean_ShouldRemoveThem()
    {
        var text = "Café\0 \u0007ok \ud800lone 😀 emoji \udc00";
        var cleaned = ReceiptTextCleaner.Clean(text, 1000);
        cleaned.ShouldBe("Café ok lone 😀 emoji");
        Penny.Backend.Domain.Ledgers.LedgerText.IsStorable(cleaned).ShouldBeTrue();
    }

    [Fact]
    public void whenTextIsTooLong_Clean_ShouldCutWithoutSplittingASurrogatePair()
    {
        ReceiptTextCleaner.Clean(new string('a', 50), 10).Length.ShouldBe(10);
        var cut = ReceiptTextCleaner.Clean("abcd😀efgh", 5);
        cut.ShouldBe("abcd");
        Penny.Backend.Domain.Ledgers.LedgerText.IsStorable(cut).ShouldBeTrue();
    }
}
