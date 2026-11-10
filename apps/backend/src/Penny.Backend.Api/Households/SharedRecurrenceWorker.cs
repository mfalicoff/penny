using Penny.Backend.Api.Configuration;
using Penny.Backend.Application.Diagnostics;
using Penny.Backend.Application.Households;

namespace Penny.Backend.Api.Households;

// Background shared recurrence runner (MAZ-59): passes run back to back while rules
// are due, then every `Recurrence__PollSeconds`. Every process may run it; leases keep
// runners apart and PostgreSQL state makes restarts resume where they stopped. Logs
// carry counts and exception types only (no ids, amounts, text or SQL).
public sealed partial class SharedRecurrenceWorker(
    SharedRecurrenceRunner runner,
    RecurrenceOptions options,
    ILogger<SharedRecurrenceWorker> logger
) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var poll = TimeSpan.FromSeconds(options.PollSeconds);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var run = await runner.RunOnceAsync(stoppingToken);
                if (run.Recorded > 0)
                    Recorded(logger, run.Recorded, run.Claimed);
                foreach (var failure in run.Failures)
                {
                    RuleFailed(logger, failure);
                    BackendTelemetry.JobFailed(BackendTelemetry.RecurrenceJob, failure);
                }
                if (run.Claimed == SharedRecurrenceRunner.BatchSize && run.Failures.Count == 0)
                    continue;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception error)
            {
                PassFailed(logger, error.GetType().Name);
                BackendTelemetry.JobFailed(BackendTelemetry.RecurrenceJob, error.GetType().Name);
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
        Message = "Recorded {Occurrences} shared recurring occurrences from {Rules} rules"
    )]
    private static partial void Recorded(ILogger logger, int occurrences, int rules);

    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "A shared recurring rule failed ({ExceptionType}); it is retried after its lease expires"
    )]
    private static partial void RuleFailed(ILogger logger, string exceptionType);

    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "Shared recurrence pass failed ({ExceptionType}); it will be retried"
    )]
    private static partial void PassFailed(ILogger logger, string exceptionType);
}
