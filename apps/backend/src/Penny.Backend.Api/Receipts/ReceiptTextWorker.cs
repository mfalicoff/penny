using Penny.Backend.Api.Configuration;
using Penny.Backend.Application.Diagnostics;
using Penny.Backend.Application.Receipts;

namespace Penny.Backend.Api.Receipts;

// Background receipt text worker (MAZ-125): drains the extraction outbox pass by pass
// and polls every `Ocr__PollSeconds` when idle. Errors are logged by type only (no
// text, ids or SQL) and the affected rows are retried with backoff.
public sealed partial class ReceiptTextWorker(
    ReceiptTextService texts,
    OcrOptions options,
    ILogger<ReceiptTextWorker> logger
) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (await texts.RunOnceAsync(stoppingToken) > 0)
                    continue;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception error)
            {
                Failed(logger, error.GetType().Name);
                BackendTelemetry.JobFailed(BackendTelemetry.ReceiptTextJob, error.GetType().Name);
            }
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(options.PollSeconds), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "Receipt text pass failed ({ExceptionType}); it will be retried"
    )]
    private static partial void Failed(ILogger logger, string exceptionType);
}
