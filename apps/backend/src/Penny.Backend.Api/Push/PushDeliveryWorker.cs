using Penny.Backend.Api.Configuration;
using Penny.Backend.Application.Push;

namespace Penny.Backend.Api.Push;

// Background push delivery (MAZ-61): passes run back to back while full batches are
// claimed, then every `Push__PollSeconds`; each pass also checks due Expo receipts.
// Every process may run it; leases keep runners apart and PostgreSQL state makes
// restarts resume. Logs carry counts, provider reason codes and exception types only
// (no tokens, ids, payloads or response bodies).
public sealed partial class PushDeliveryWorker(
    PushDeliveryRunner runner,
    PushOptions options,
    ILogger<PushDeliveryWorker> logger
) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (options.Apns is null)
            ApnsNotConfigured(logger);
        var poll = TimeSpan.FromSeconds(options.PollSeconds);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var run = await runner.RunOnceAsync(stoppingToken);
                if (run.Accepted + run.Retried + run.Failed + run.InvalidTokens > 0)
                    Delivered(logger, run.Accepted, run.Retried, run.Failed, run.InvalidTokens);
                foreach (var failure in run.Failures)
                    MessageFailed(logger, failure);
                var receipts = await runner.CheckReceiptsAsync(stoppingToken);
                if (receipts > 0)
                    ReceiptsChecked(logger, receipts);
                if (run.Claimed == PushDeliveryRunner.BatchSize && run.Failures.Count == 0)
                    continue;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception error)
            {
                PassFailed(logger, error.GetType().Name);
            }
            try
            {
                await Task.Delay(poll, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    [LoggerMessage(
        Level = LogLevel.Information,
        Message = "Push pass: {Accepted} accepted, {Retried} retrying, {Failed} failed, {Invalid} invalid tokens removed"
    )]
    private static partial void Delivered(
        ILogger logger,
        int accepted,
        int retried,
        int failed,
        int invalid
    );

    [LoggerMessage(Level = LogLevel.Information, Message = "Checked {Receipts} Expo push receipts")]
    private static partial void ReceiptsChecked(ILogger logger, int receipts);

    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "A push message failed ({ExceptionType}); it is retried after its lease expires"
    )]
    private static partial void MessageFailed(ILogger logger, string exceptionType);

    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "Push delivery pass failed ({ExceptionType}); it will be retried"
    )]
    private static partial void PassFailed(ILogger logger, string exceptionType);

    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "APNs is not configured (Push__Apns__*); native iOS deliveries wait until it is or they expire"
    )]
    private static partial void ApnsNotConfigured(ILogger logger);
}
