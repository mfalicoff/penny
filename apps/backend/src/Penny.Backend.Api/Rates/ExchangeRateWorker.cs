using Penny.Backend.Api.Configuration;
using Penny.Backend.Application.Diagnostics;
using Penny.Backend.Application.Rates;

namespace Penny.Backend.Api.Rates;

// Background ECB reference rate refresh (MAZ-151): one fetch at startup, then every
// `ExchangeRates__RefreshMinutes`; a failed fetch is logged by exception type and retried
// at the next interval. Every process may run it: the cache is an idempotent upsert of
// public data, so no lease is needed. Logs carry counts only, never rates.
public sealed partial class ExchangeRateWorker(
    ExchangeRateRefresher refresher,
    ExchangeRatesOptions options,
    ILogger<ExchangeRateWorker> logger
) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var refresh = await refresher.RunOnceAsync(stoppingToken);
                Refreshed(logger, refresh.Quotes, refresh.Changed, refresh.History);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception error)
            {
                Failed(logger, error.GetType().Name);
                BackendTelemetry.JobFailed(BackendTelemetry.ExchangeRatesJob, error.GetType().Name);
            }
            try
            {
                await Task.Delay(options.RefreshInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    [LoggerMessage(
        Level = LogLevel.Information,
        Message = "Fetched {Quotes} reference rates, {Changed} new or changed (full history: {History})"
    )]
    private static partial void Refreshed(ILogger logger, int quotes, int changed, bool history);

    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "Reference rate refresh failed ({ExceptionType}); it will be retried"
    )]
    private static partial void Failed(ILogger logger, string exceptionType);
}
