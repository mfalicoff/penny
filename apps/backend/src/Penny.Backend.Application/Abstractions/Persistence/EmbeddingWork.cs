namespace Penny.Backend.Application.Abstractions.Persistence;

// A claimed embedding outbox row: the search document or receipt text chunk
// (`Target`), the passage to embed and how many earlier attempts failed, plus when it
// became due (for the worker lag metric).
public sealed record EmbeddingWork(
    long DocumentId,
    string Passage,
    int Attempts,
    DateTimeOffset DueAt,
    EmbeddingTarget Target = EmbeddingTarget.Document
);
