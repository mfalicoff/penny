using Penny.Backend.Api.Configuration;
using Penny.Backend.Application.Diagnostics;
using Penny.Backend.Application.InboundMail;

namespace Penny.Backend.Api.InboundMail;

// Background inbound mail worker (MAZ-184): converts pending messages pass by pass and
// polls every `InboundMail__PollSeconds` when idle. Errors are logged by type only (no
// addresses, subjects or content) and the message is retried once its lease expires.
public sealed partial class InboundMailWorker(
    InboundMailProcessor processor,
    InboundMailWorkerOptions options,
    ILogger<InboundMailWorker> logger
) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (await processor.RunOnceAsync(stoppingToken) > 0)
                    continue;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception error)
            {
                Failed(logger, error.GetType().Name);
                BackendTelemetry.JobFailed(BackendTelemetry.InboundMailJob, error.GetType().Name);
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
        Message = "Inbound mail pass failed ({ExceptionType}); it will be retried"
    )]
    private static partial void Failed(ILogger logger, string exceptionType);
}
