using Penny.Backend.Application.Abstractions.Search;

namespace Penny.Backend.Application.Search;

// The meaning tier's acceptance rule (MAZ-167): the lowest cosine similarity a result
// needs to match one query by meaning. It is the query's baseline (its mean similarity
// to the neutral `SearchTuning.MeaningAnchors` passages) plus `MeaningMargin`, and at
// least `MeaningFloor`. Every meaning score (entry embeddings, and receipt chunks in
// MAZ-125) is compared with this one value. The anchors are embedded once per model;
// vectors are L2-normalized, so the mean similarity is the dot product with their mean.
public sealed class MeaningThreshold
{
    private readonly float[] anchor;

    public MeaningThreshold(ITextEmbedder embedder)
    {
        ArgumentNullException.ThrowIfNull(embedder);
        var vectors = embedder.EmbedPassages(SearchTuning.MeaningAnchors);
        anchor = new float[embedder.Dimensions];
        foreach (var vector in vectors)
            for (var i = 0; i < anchor.Length; i++)
                anchor[i] += vector[i] / vectors.Count;
    }

    public double For(float[] queryVector)
    {
        ArgumentNullException.ThrowIfNull(queryVector);
        double baseline = 0;
        for (var i = 0; i < anchor.Length; i++)
            baseline += anchor[i] * queryVector[i];
        return Math.Max(SearchTuning.MeaningFloor, baseline + SearchTuning.MeaningMargin);
    }
}
