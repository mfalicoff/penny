using Penny.Backend.Persistence.Receipts;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Receipts;

// The bounded-decode planning of the local OCR engine (MAZ-125): whatever the input's
// dimensions, the engine never sees more than MaxWidth × StripHeight pixels at once and
// never more than MaxPixels per image or page.
public sealed class ReceiptImagePlanTests
{
    [Theory]
    [InlineData(30000, 30000, 2500, 2500, false)]
    [InlineData(1200, 1600, 1200, 1600, false)]
    [InlineData(5000, 400, 2500, 200, false)]
    [InlineData(2500, 16000, 2500, 16000, false)]
    [InlineData(2500, 16001, 2500, 16000, true)]
    [InlineData(100, 2_000_000, 100, 400_000, true)]
    [InlineData(1_000_000, 1, 2500, 1, false)]
    public void whenImageHasAnySize_Plan_ShouldBoundWidthAndPixels(
        double width,
        double height,
        int planWidth,
        int planHeight,
        bool truncated
    )
    {
        var plan = LocalReceiptTextExtractor.Plan(width, height);
        plan.ShouldBe((planWidth, planHeight, truncated));
        ((long)plan.Width * plan.Height).ShouldBeLessThanOrEqualTo(
            LocalReceiptTextExtractor.MaxPixels
        );
    }

    [Fact]
    public void whenImageIsTall_Strips_ShouldCoverEveryRowWithOverlappingBoundedStrips()
    {
        LocalReceiptTextExtractor.Strips(4000).ShouldBe([(0, 4000)]);
        var strips = LocalReceiptTextExtractor.Strips(10000).ToList();
        strips.ShouldBe([(0, 4000), (3880, 4000), (7760, 2240)]);
        strips.ShouldAllBe(strip => strip.Height <= LocalReceiptTextExtractor.StripHeight);
        for (var index = 1; index < strips.Count; index++)
            (strips[index - 1].Top + strips[index - 1].Height - strips[index].Top).ShouldBe(
                LocalReceiptTextExtractor.StripOverlap
            );
        (strips[^1].Top + strips[^1].Height).ShouldBe(10000);
    }

    [Fact]
    public void whenStripsOverlap_JoinStrips_ShouldKeepOrderAndDropRepeatedLines()
    {
        LocalReceiptTextExtractor
            .JoinStrips([
                "MARCHE ATWATER\nPommes 3.49\nPoires 2.10\n",
                "\nPoires 2.10\nFromage 8.99\n",
                "",
                "TOTAL 14.58\n",
            ])
            .ShouldBe("MARCHE ATWATER\nPommes 3.49\nPoires 2.10\nFromage 8.99\nTOTAL 14.58");
    }
}
