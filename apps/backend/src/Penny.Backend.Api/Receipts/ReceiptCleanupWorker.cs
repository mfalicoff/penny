using Penny.Backend.Application.Diagnostics;
using Penny.Backend.Application.Receipts;

namespace Penny.Backend.Api.Receipts;

// Background unlinked receipt cleanup (MAZ-165): one pass at startup, then every six
// hours. Only the count is logged (no ids, names or paths); a failed pass is logged by
// exception type and retried at the next interval.
public sealed partial class ReceiptCleanupWorker(
    ReceiptCleanupService cleanup,
    ILogger<ReceiptCleanupWorker> logger
) : BackgroundService
{
    public static readonly TimeSpan Interval = TimeSpan.FromHours(6);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var removed = await cleanup.RunOnceAsync(stoppingToken);
                if (removed > 0)
                    Removed(logger, removed);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception error)
            {
                Failed(logger, error.GetType().Name);
                BackendTelemetry.JobFailed(
                    BackendTelemetry.ReceiptCleanupJob,
                    error.GetType().Name
                );
            }
            try
            {
                await Task.Delay(Interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Removed {Count} unlinked receipts")]
    private static partial void Removed(ILogger logger, long count);

    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "Unlinked receipt cleanup failed ({ExceptionType}); it will be retried"
    )]
    private static partial void Failed(ILogger logger, string exceptionType);
}
