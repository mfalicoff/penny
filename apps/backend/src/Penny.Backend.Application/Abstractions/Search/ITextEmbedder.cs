namespace Penny.Backend.Application.Abstractions.Search;

// A local sentence-embedding model (MAZ-121). Vectors are L2-normalized, so cosine
// similarity is their dot product. Text never leaves the process.
public interface ITextEmbedder
{
    // Identifies the model and its pinned files; stored with every embedding.
    string ModelId { get; }

    int Dimensions { get; }

    // The most tokens the model reads from one input, prefix and special tokens
    // included; longer passages are truncated.
    int MaxTokens { get; }

    // Search text (the normalized query).
    float[] EmbedQuery(string query);

    // Indexed text (title, note and category, or a receipt text chunk; never account
    // names).
    IReadOnlyList<float[]> EmbedPassages(IReadOnlyList<string> passages);

    // How many tokens the model reads for `passage` (the passage prefix and special
    // tokens included), so long receipt text can be split into chunks that fit.
    int CountPassageTokens(string passage);
}
