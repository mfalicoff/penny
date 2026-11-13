namespace Penny.Backend.Application.Search;

// Fixed matching parameters (docs/reference/search.md, "Matching"), tuned with the
// shared fixtures. Changing the meaning rule or limit changes results, not stored
// data; changing the model requires `search-rebuild`.
public static class SearchTuning
{
    // pg_trgm word_similarity(query, document) at or above this is a typo match.
    public const double WordSimilarity = 0.6;

    // Typo matching needs at least this many code points in the normalized query.
    public const int TypoMinimumLength = 3;

    // A meaning match needs a cosine similarity of at least `MeaningFloor` and at least
    // `MeaningMargin` above the query's baseline: its mean similarity to these neutral
    // passages (MAZ-167). multilingual-e5-small scores most pairs of short texts about
    // 0.8, and some queries ("something", "hello") sit close to everything; the
    // baseline measures how close "anything" is to this query. See search.md.
    public static readonly IReadOnlyList<string> MeaningAnchors = ["", "a", "x", "item", "entry"];

    public const double MeaningMargin = 0.015;

    public const double MeaningFloor = 0.82;

    // Meaning matches are limited to the closest authorized results.
    public const int MeaningLimit = 200;
}
