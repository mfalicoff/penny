namespace Penny.Backend.Application.Abstractions.Persistence;

// The embedding of a claimed passage. It is stored only if the passage is unchanged.
public sealed record EmbeddingResult(long DocumentId, string Passage, float[] Vector);
