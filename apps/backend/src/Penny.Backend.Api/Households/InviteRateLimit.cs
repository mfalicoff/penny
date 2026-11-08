using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Penny.Backend.Api.Authentication;

namespace Penny.Backend.Api.Households;

// Legacy `inviteLimit` on POST /api/households/join: a fixed 10-minute window of 20
// attempts per client (same client key as the sign-in limit), so invite codes cannot
// be guessed at speed. The rejection is written by AuthRateLimit's shared handler.
public static class InviteRateLimit
{
    public const string Policy = "invites";
    public const string Message = "Too many invite attempts. Try again later.";
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(10);

    public static void Configure(RateLimiterOptions options, int permits) =>
        options.AddPolicy(
            Policy,
            context =>
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
