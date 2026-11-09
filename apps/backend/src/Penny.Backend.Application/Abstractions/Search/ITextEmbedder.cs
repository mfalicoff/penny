namespace Penny.Backend.Application.Abstractions.Search;

// A local sentence-embedding model (MAZ-121). Vectors are L2-normalized, so cosine
// similarity is their dot product. Text never leaves the process.
public interface ITextEmbedder
{
    // Identifies the model and its pinned files; stored with every embedding.
    string ModelId { get; }

    int Dimensions { get; }

    // Search text (the normalized query).
    float[] EmbedQuery(string query);

    // Indexed text (title, note and category; never account names).
    IReadOnlyList<float[]> EmbedPassages(IReadOnlyList<string> passages);
}
