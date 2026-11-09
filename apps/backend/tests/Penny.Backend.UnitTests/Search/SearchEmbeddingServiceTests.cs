using Penny.Backend.Application.Search;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Search;

public sealed class SearchEmbeddingServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task whenOutboxHasRows_CatchUp_ShouldEmbedEveryRowInBatches()
    {
        var outbox = new InMemorySearchOutbox();
        for (var id = 1; id <= SearchEmbeddingService.BatchSize + 5; id++)
            outbox.Rows[id] = ("passage " + id, DateTimeOffset.UnixEpoch, 0, null, null);
        var embedder = new DeterministicEmbedder();
        var service = new SearchEmbeddingService(outbox, embedder, new ManualClock(Now));
        (await service.RunOnceAsync(CancellationToken.None)).ShouldBe(
            SearchEmbeddingService.BatchSize
        );
        (await service.CatchUpAsync(CancellationToken.None)).ShouldBe(5);
        outbox.Rows.Values.ShouldAllBe(row =>
            row.Due == null && row.Vector != null && row.Lease == null
        );
        embedder.Seen.Count.ShouldBe(SearchEmbeddingService.BatchSize + 5);
        (await service.RunOnceAsync(CancellationToken.None)).ShouldBe(0);
    }

    [Fact]
    public async Task whenEmbeddingFails_RunOnce_ShouldReleaseWithExponentialBackoff()
    {
        var outbox = new InMemorySearchOutbox();
        outbox.Rows[1] = ("coffee", DateTimeOffset.UnixEpoch, 3, null, null);
        var clock = new ManualClock(Now);
        var embedder = new DeterministicEmbedder { Fail = true };
        var service = new SearchEmbeddingService(outbox, embedder, clock);
        await Should.ThrowAsync<InvalidOperationException>(() =>
            service.RunOnceAsync(CancellationToken.None)
        );
        var row = outbox.Rows[1];
        row.Attempts.ShouldBe(4);
        row.Lease.ShouldBeNull();
        row.Due.ShouldBe(Now + TimeSpan.FromSeconds(8));
        // Not due yet: nothing is claimed until the backoff passes.
        embedder.Fail = false;
        (await service.RunOnceAsync(CancellationToken.None)).ShouldBe(0);
        clock.Advance(TimeSpan.FromSeconds(8));
        (await service.RunOnceAsync(CancellationToken.None)).ShouldBe(1);
        outbox.Rows[1].Vector.ShouldNotBeNull();
        SearchEmbeddingService.Backoff(30).ShouldBe(SearchEmbeddingService.MaxBackoff);
    }

    [Fact]
    public async Task whenPassageChangesWhileEmbedding_Complete_ShouldNotStoreTheStaleVector()
    {
        var outbox = new InMemorySearchOutbox();
        outbox.Rows[1] = ("old", DateTimeOffset.UnixEpoch, 0, null, null);
        var service = new SearchEmbeddingService(
            outbox,
            new ChangingEmbedder(outbox),
            new ManualClock(Now)
        );
        (await service.RunOnceAsync(CancellationToken.None)).ShouldBe(1);
        outbox.Rows[1].Vector.ShouldBeNull();
        outbox.Rows[1].Due.ShouldBe(DateTimeOffset.UnixEpoch);
    }
}
