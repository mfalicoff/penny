namespace Penny.Backend.Api.Configuration;

// Search settings (MAZ-121). `Search__ModelDirectory` is required: the HTTP host loads
// and verifies the pinned embedding model at startup and fails before listening if it
// is missing. `Search__EmbeddingWorker=false` stops this process from draining the
// embedding outbox (another process may); `Search__RateLimitPermits` is per session
// per minute.
public sealed record SearchOptions(
    string ModelDirectory,
    bool EmbeddingWorker,
    int RateLimitPermits
)
{
    public static SearchOptions Read(IConfiguration configuration)
    {
        var directory = configuration["Search:ModelDirectory"];
        if (string.IsNullOrWhiteSpace(directory) || !Path.IsPathFullyQualified(directory))
            throw new InvalidOperationException(
                "Set Search__ModelDirectory to the absolute directory holding the search model (node apps/backend/development/download-model.mjs)."
            );
        var worker = configuration["Search:EmbeddingWorker"] switch
        {
            null => true,
            "true" => true,
            "false" => false,
            _ => throw new InvalidOperationException(
                "Search:EmbeddingWorker must be true or false."
            ),
        };
        return new(
            directory,
            worker,
            BackendOptions.ReadBounded(configuration, "Search:RateLimitPermits", 30, 1, 10_000)
        );
    }
}
