using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Application.Authentication;

namespace Penny.Backend.Api.Search;

// 30 searches per minute per session (docs/migration/search.md, "Limits"). The limiter
// runs before authentication, so the partition is the hash of the presented session
// token; requests without one are not limited here and fail authentication (401).
public static class SearchRateLimit
{
    public const string Policy = "search";
    public const string Message = "Too many searches. Try again in a minute.";
    public const int Permits = 30;
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(1);

    public static void Configure(RateLimiterOptions options, int permits) =>
        options.AddPolicy(
            Policy,
            context =>
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
