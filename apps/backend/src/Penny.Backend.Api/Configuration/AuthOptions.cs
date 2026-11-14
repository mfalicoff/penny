using System.Net;

namespace Penny.Backend.Api.Configuration;

// Password sign-in, cookie and origin settings. No proxy headers are trusted unless
// TrustedProxies lists the proxy.
public sealed record AuthOptions(
    bool AllowRegistration,
    bool SecureCookies,
    IReadOnlyList<string> AllowedOrigins,
    IReadOnlyList<IPNetwork> TrustedProxies,
    int RateLimitPermits,
    int PasswordResetHours,
    int InviteRateLimitPermits
)
{
    public const string DefaultOrigins = "http://localhost:4173,http://127.0.0.1:4173";

    public static AuthOptions Read(IConfiguration configuration) =>
        new(
            ReadBoolean(configuration, "Auth:AllowRegistration", true),
            ReadBoolean(configuration, "Auth:SecureCookies", false),
            ReadOrigins(configuration["Auth:AllowedOrigins"] ?? DefaultOrigins),
            ReadNetworks(configuration["Auth:TrustedProxies"] ?? ""),
            BackendOptions.ReadBounded(configuration, "Auth:RateLimitPermits", 40, 1, 10_000),
            // Operator-issued reset codes (MAZ-123): 24 hours by default, at most 7 days.
            BackendOptions.ReadBounded(configuration, "Auth:PasswordResetHours", 24, 1, 168),
            // Invite limit (MAZ-56): 20 join attempts per 10 minutes per client.
            BackendOptions.ReadBounded(configuration, "Auth:InviteRateLimitPermits", 20, 1, 10_000)
        );

    private static bool ReadBoolean(IConfiguration configuration, string key, bool fallback)
    {
        var value = configuration[key];
        if (value is null)
            return fallback;
        return bool.TryParse(value, out var parsed)
            ? parsed
            : throw new InvalidOperationException($"{key} must be true or false.");
    }

    private static List<string> Split(string value) =>
        [
            .. value.Split(
                ',',
                StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries
            ),
        ];

    // Browsers send origins as scheme://host[:non-default-port] with a lowercase host;
    // requiring that form keeps the CORS and origin checks byte-for-byte identical.
    private static List<string> ReadOrigins(string value)
    {
        var origins = Split(value);
        foreach (var origin in origins)
            if (
                !Uri.TryCreate(origin, UriKind.Absolute, out var uri)
                || uri.Scheme is not ("http" or "https")
                || !string.Equals(
                    uri.GetLeftPart(UriPartial.Authority),
                    origin,
                    StringComparison.Ordinal
                )
            )
                throw new InvalidOperationException(
                    "Auth:AllowedOrigins must be comma-separated origins such as https://penny.example.com."
                );
        return origins;
    }

    private static List<IPNetwork> ReadNetworks(string value) =>
        [
            .. Split(value)
                .Select(entry =>
                    IPNetwork.TryParse(entry, out var network) ? network
                    : IPAddress.TryParse(entry, out var address)
                        ? new IPNetwork(address, address.GetAddressBytes().Length * 8)
                    : throw new InvalidOperationException(
                        "Auth:TrustedProxies must be comma-separated IP addresses or CIDR ranges."
                    )
                ),
        ];
}
