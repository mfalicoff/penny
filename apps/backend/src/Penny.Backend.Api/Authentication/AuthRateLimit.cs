using System.Net;
using System.Net.Sockets;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Penny.Backend.Api.Errors;

namespace Penny.Backend.Api.Authentication;

// Legacy express-rate-limit: one fixed 15-minute window per client shared by every
// sign-in route, IPv6 clients grouped by /56.
public static class AuthRateLimit
{
    public const string Policy = "auth";
    public const string Message = "Too many attempts. Please try again in 15 minutes.";
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(15);

    public static void Configure(RateLimiterOptions options, int permits)
    {
        options.AddPolicy(
            Policy,
            context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    ClientKey(context.Connection.RemoteIpAddress),
                    _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = permits,
                        Window = Window,
                        QueueLimit = 0,
                    }
                )
        );
        options.OnRejected = (rejected, cancellationToken) =>
        {
            if (rejected.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
                rejected.HttpContext.Response.Headers.RetryAfter = (
                    (int)Math.Ceiling(retryAfter.TotalSeconds)
                ).ToString(System.Globalization.CultureInfo.InvariantCulture);
            return new ValueTask(
                ApiErrors.WriteAsync(rejected.HttpContext, 429, Message, cancellationToken)
            );
        };
    }

    public static string ClientKey(IPAddress? address)
    {
        if (address is null)
            return "unknown";
        if (address.IsIPv4MappedToIPv6)
            address = address.MapToIPv4();
        if (address.AddressFamily != AddressFamily.InterNetworkV6)
            return address.ToString();
        var bytes = address.GetAddressBytes();
        Array.Clear(bytes, 7, bytes.Length - 7);
        return new IPAddress(bytes) + "/56";
    }
}
