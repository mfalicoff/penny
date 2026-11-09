using System.Security.Cryptography;
using System.Text;
using Penny.Backend.Application.Abstractions.Search;

namespace Penny.Backend.UnitTests.Search;

// Worker-mechanics stand-in: a fixed vector per text (no meaning). Meaning matches are
// tested only with the real model in the integration tests.
internal sealed class DeterministicEmbedder : ITextEmbedder
{
    public bool Fail { get; set; }

    public List<string> Seen { get; } = [];

    public string ModelId => "deterministic-test";

    public int Dimensions => 4;

    public float[] EmbedQuery(string query) => Vector(query);

    public IReadOnlyList<float[]> EmbedPassages(IReadOnlyList<string> passages)
    {
        if (Fail)
            throw new InvalidOperationException("Embedding failed.");
        Seen.AddRange(passages);
        return [.. passages.Select(Vector)];
    }

    private static float[] Vector(string text) =>
        [.. SHA256.HashData(Encoding.UTF8.GetBytes(text)).Take(4).Select(value => (float)value)];
}
