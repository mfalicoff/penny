using System.Text.Json;
using Penny.Backend.Application.Search;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Search;

public sealed class SearchServiceTests
{
    private static JsonElement Body(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    [Fact]
    public async Task whenAnchorEmbeddingFailsOnce_Search_ShouldComputeTheThresholdOnTheNextSearch()
    {
        var embedder = new DeterministicEmbedder { Fail = true };
        var search = new InMemorySearchOutbox();
        var service = new SearchService(search, embedder);

        // The neutral anchors cannot be embedded yet (e.g. the model is still loading).
        await Should.ThrowAsync<InvalidOperationException>(() =>
            service.SearchAsync("viewer", Body("""{"query":"coffee"}"""), CancellationToken.None)
        );
        search.Searches.ShouldBeEmpty();

        // The failure is not cached for the life of the process.
        embedder.Fail = false;
        await service.SearchAsync("viewer", Body("""{"query":"coffee"}"""), CancellationToken.None);
        var criteria = search.Searches.ShouldHaveSingleItem();
        criteria.QueryVector.ShouldNotBeNull();
        criteria.MeaningSimilarity.ShouldBeGreaterThanOrEqualTo(SearchTuning.MeaningFloor);
        embedder.Seen.ShouldBe(SearchTuning.MeaningAnchors);
    }
}
