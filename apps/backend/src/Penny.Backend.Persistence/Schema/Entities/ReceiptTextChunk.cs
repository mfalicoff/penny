using Pgvector;

namespace Penny.Backend.Persistence.Schema.Entities;

// One embedding-sized passage of a receipt's text (MAZ-125). Kept apart from the
// entry's search document, keyed by receipt, so the meaning tier can apply the
// receipt's visibility inside the vector index scan. `EmbeddingDueAt` set means the
// embedding is owed: these rows are a second embedding outbox drained by the same
// worker as `search_documents`.
public sealed class ReceiptTextChunk
{
    public long Id { get; set; }
    public required string ReceiptId { get; set; }
    public int Ordinal { get; set; }
    public required string Passage { get; set; }
    public Vector? Embedding { get; set; }
    public string? EmbeddingModel { get; set; }
    public DateTimeOffset? EmbeddingDueAt { get; set; }
    public int EmbeddingAttempts { get; set; }
    public string? LeaseToken { get; set; }
    public DateTimeOffset? LeaseExpiresAt { get; set; }
}
