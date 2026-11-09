using Penny.Backend.Application.Search;

namespace Penny.Backend.Api.Search;

// Background embedding worker (MAZ-121): polls the embedding outbox every second and
// drains it batch by batch, so a write is searchable by meaning within seconds. Errors
// are logged by type only (no text, ids or SQL) and retried with the outbox backoff.
public sealed partial class SearchEmbeddingWorker(
    SearchEmbeddingService embeddings,
    ILogger<SearchEmbeddingWorker> logger
) : BackgroundService
{
    public static readonly TimeSpan Poll = TimeSpan.FromSeconds(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (await embeddings.RunOnceAsync(stoppingToken) > 0)
                    continue;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception error)
            {
                Failed(logger, error.GetType().Name);
            }
            try
            {
                await Task.Delay(Poll, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "Search embedding batch failed ({ExceptionType}); it will be retried"
    )]
    private static partial void Failed(ILogger logger, string exceptionType);
}
