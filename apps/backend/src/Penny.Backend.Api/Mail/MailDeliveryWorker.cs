using Penny.Backend.Application.Diagnostics;
using Penny.Backend.Application.Mail;

namespace Penny.Backend.Api.Mail;

// Background mail delivery (MAZ-124): passes run back to back while full batches are
// claimed, then every `Email__PollSeconds`. Every process may run it; leases keep
// runners apart. Logs carry counts, reason codes and exception types only: no
// addresses, links, codes or server replies.
public sealed partial class MailDeliveryWorker(
    MailDeliveryRunner runner,
    TimeSpan poll,
    ILogger<MailDeliveryWorker> logger
) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var run = await runner.RunOnceAsync(stoppingToken);
                if (run.Sent + run.Retried + run.Failed + run.Dropped > 0)
                    Delivered(logger, run.Sent, run.Retried, run.Failed, run.Dropped);
                if (run.Reasons.Count > 0)
                    Problems(logger, string.Join(", ", run.Reasons));
                foreach (var failure in run.Failures)
                {
                    MessageFailed(logger, failure);
                    BackendTelemetry.JobFailed(BackendTelemetry.MailDeliveryJob, failure);
                }
                if (run.Claimed == MailDeliveryRunner.BatchSize && run.Failures.Count == 0)
                    continue;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception error)
            {
                PassFailed(logger, error.GetType().Name);
                BackendTelemetry.JobFailed(BackendTelemetry.MailDeliveryJob, error.GetType().Name);
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
        Message = "Mail pass: {Sent} sent, {Retried} retrying, {Failed} failed, {Dropped} no longer needed"
    )]
    private static partial void Delivered(
        ILogger logger,
        int sent,
        int retried,
        int failed,
        int dropped
    );

    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "Mail delivery problems: {Reasons}. See docs/self-hosting/email.md#troubleshooting"
    )]
    private static partial void Problems(ILogger logger, string reasons);

    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "A mail message failed ({ExceptionType}); it is retried later"
    )]
    private static partial void MessageFailed(ILogger logger, string exceptionType);

    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "Mail delivery pass failed ({ExceptionType}); it will be retried"
    )]
    private static partial void PassFailed(ILogger logger, string exceptionType);
}
