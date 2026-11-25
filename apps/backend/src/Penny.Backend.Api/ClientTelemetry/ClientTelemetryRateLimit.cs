using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Application.Authentication;

namespace Penny.Backend.Api.ClientTelemetry;

// MAZ-129: client telemetry requests per session per minute (`ClientTelemetry__RateLimitPermits`).
// Like search, the limiter runs before authentication, so the partition is the hash of the
// presented session token; requests without one are not limited here and fail
// authentication (401). Over the limit answers 429 with Retry-After, which the Faro SDK
// and the OpenTelemetry exporters honour.
public static class ClientTelemetryRateLimit
{
    public const string Policy = "client-telemetry";
    public const string Message = "Too many telemetry reports. Try again later.";
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(1);

    public static void Configure(RateLimiterOptions options, int permits) =>
        options.AddPolicy(Policy, context =>
            SessionCredentials.Read(context.Request) is { } token
                ? RateLimitPartition.GetFixedWindowLimiter(
                    SessionTokens.Hash(token),
                    _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = permits,
                        Window = Window,
                        QueueLimit = 0,
                    }
                )
                : RateLimitPartition.GetNoLimiter("anonymous")
        );
}
