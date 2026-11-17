using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Penny.Backend.Api.Authentication;

namespace Penny.Backend.Api.InboundMail;

// The recipient-list limit (MAZ-184): a fixed one-minute window per client. Each
// Worker isolate refreshes about once a minute, plus at most once every 10 seconds on
// a miss. The rejection is written by AuthRateLimit's shared handler.
public static class InboundMailRateLimit
{
    public const string Policy = "inbound-mail-recipients";
    public const string Message = "Too many recipient list requests. Try again later.";
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(1);

    public static void Configure(RateLimiterOptions options, int permits) =>
        options.AddPolicy(Policy, context =>
            RateLimitPartition.GetFixedWindowLimiter(
                AuthRateLimit.ClientKey(context.Connection.RemoteIpAddress),
                _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = permits,
                    Window = Window,
                    QueueLimit = 0,
                }
            )
        );
}
