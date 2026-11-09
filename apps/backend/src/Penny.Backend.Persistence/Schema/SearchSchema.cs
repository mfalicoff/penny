namespace Penny.Backend.Persistence.Schema;

// Search storage facts (MAZ-121). An administrator creates both extensions once
// (`vector` is not a trusted extension); `migrate` refuses to run without them and
// readiness reports `search-extensions` when they are missing or too old.
public static class SearchSchema
{
    public const int Dimensions = 384;
    public const string Vector = "vector";
    public const string Trigrams = "pg_trgm";

    // Iterative index scans (filtering inside the HNSW scan) arrived in pgvector 0.8.0;
    // `word_similarity` and `<%` exist in every pg_trgm shipped with PostgreSQL 18.
    public static readonly Version MinimumVector = new(0, 8, 0);
    public static readonly Version MinimumTrigrams = new(1, 6);
}
