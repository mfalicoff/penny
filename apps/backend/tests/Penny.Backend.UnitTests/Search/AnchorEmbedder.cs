using Penny.Backend.Application.Abstractions.Search;

namespace Penny.Backend.UnitTests.Search;

// Meaning-threshold stand-in: passages alternate between (1, 0) and (0.8, 0.2).
internal sealed class AnchorEmbedder : ITextEmbedder
{
    public List<string> Seen { get; } = [];

    public string ModelId => "anchor-test";

    public int Dimensions => 2;

    public int MaxTokens => 512;

    public int CountPassageTokens(string passage) => passage.Length;

    public float[] EmbedQuery(string query) => throw new NotSupportedException();

    public IReadOnlyList<float[]> EmbedPassages(IReadOnlyList<string> passages)
    {
        Seen.AddRange(passages);
        return [.. passages.Select((_, index) => index % 2 == 0 ? new[] { 1f, 0f } : [0.8f, 0.2f])];
    }
}
