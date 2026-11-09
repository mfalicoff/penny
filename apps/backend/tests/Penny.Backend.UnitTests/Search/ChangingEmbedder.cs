using Penny.Backend.Application.Abstractions.Search;

namespace Penny.Backend.UnitTests.Search;

// Simulates a write that changes the passage (and resets the lease) mid-embedding.
internal sealed class ChangingEmbedder(InMemorySearchOutbox outbox) : ITextEmbedder
{
    public string ModelId => "changing-test";

    public int Dimensions => 1;

    public float[] EmbedQuery(string query) => [1];

    public IReadOnlyList<float[]> EmbedPassages(IReadOnlyList<string> passages)
    {
        outbox.Rows[1] = ("new", DateTimeOffset.UnixEpoch, 0, null, null);
        return [.. passages.Select(_ => new float[] { 1 })];
    }
}
