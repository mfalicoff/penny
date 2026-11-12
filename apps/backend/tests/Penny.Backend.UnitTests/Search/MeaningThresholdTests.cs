using Penny.Backend.Application.Search;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Search;

// The meaning acceptance rule (MAZ-167) with hand-made vectors; the tuned values are
// checked with the real model by the search fixtures.
public sealed class MeaningThresholdTests
{
    [Fact]
    public void whenQueryNearTheAnchors_For_ShouldRequireTheBaselinePlusTheMargin()
    {
        var embedder = new AnchorEmbedder();
        var threshold = new MeaningThreshold(embedder);

        // Five anchors: three (1, 0) and two (0.8, 0.2) average to (0.92, 0.08).
        SearchTuning.MeaningAnchors.Count.ShouldBe(5);
        threshold.For([1, 0]).ShouldBe(0.92 + SearchTuning.MeaningMargin, tolerance: 1e-6);
        embedder.Seen.ShouldBe(SearchTuning.MeaningAnchors);
    }

    [Fact]
    public void whenQueryFarFromTheAnchors_For_ShouldRequireTheFloor()
    {
        var threshold = new MeaningThreshold(new AnchorEmbedder());

        threshold.For([0, 1]).ShouldBe(SearchTuning.MeaningFloor);
    }
}
