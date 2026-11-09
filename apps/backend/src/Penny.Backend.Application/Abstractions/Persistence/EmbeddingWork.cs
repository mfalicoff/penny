namespace Penny.Backend.Application.Abstractions.Persistence;

// A claimed embedding outbox row: the document, the passage to embed and how many
// earlier attempts failed.
public sealed record EmbeddingWork(long DocumentId, string Passage, int Attempts);
