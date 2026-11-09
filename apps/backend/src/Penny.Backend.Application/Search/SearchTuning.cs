namespace Penny.Backend.Application.Search;

// Fixed matching parameters (docs/migration/search.md, "Matching"), tuned with the
// shared fixtures. Changing the meaning threshold or limit changes results, not
// stored data; changing the model requires `search-rebuild`.
public static class SearchTuning
{
    // pg_trgm word_similarity(query, document) at or above this is a typo match.
    public const double WordSimilarity = 0.6;

    // Typo matching needs at least this many code points in the normalized query.
    public const int TypoMinimumLength = 3;

    // Cosine similarity at or above this is a meaning match (multilingual-e5-small
    // similarities cluster between 0.75 and 0.95; see search.md for the tuning).
    public const double MeaningSimilarity = 0.82;

    // Meaning matches are limited to the closest authorized results.
    public const int MeaningLimit = 200;
}
