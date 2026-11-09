namespace Penny.Backend.Application.Abstractions.Persistence;

// `search-rebuild`: documents written, removed and queued for embedding.
public sealed record SearchRebuildReport(long Written, long Removed, long Queued);
