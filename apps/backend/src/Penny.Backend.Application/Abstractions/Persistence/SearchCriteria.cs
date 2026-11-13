using Penny.Backend.Domain.Search;

namespace Penny.Backend.Application.Abstractions.Persistence;

// One search page for the session's viewer. `QueryVector` is null when the meaning
// tier does not apply; then `MeaningSimilarity` and `ModelId` are unused.
// `MeaningSimilarity` is the lowest cosine similarity that matches this query by
// meaning (`MeaningThreshold`). `Limit` is the page size plus one.
public sealed record SearchCriteria(
    string ViewerId,
    SearchRequest Request,
    SearchPosition? After,
    int Limit,
    float[]? QueryVector,
    double MeaningSimilarity,
    string ModelId
);
