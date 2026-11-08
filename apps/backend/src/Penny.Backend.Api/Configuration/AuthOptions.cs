using System.Net;

namespace Penny.Backend.Api.Configuration;

// Legacy equivalents: ALLOW_REGISTRATION, COOKIE_SECURE and CORS_ORIGINS. The legacy
// server trusted no proxy headers; TrustedProxies keeps that default.
public sealed record AuthOptions(
    bool AllowRegistration,
    bool SecureCookies,
    IReadOnlyList<string> AllowedOrigins,
    IReadOnlyList<IPNetwork> TrustedProxies,
    int RateLimitPermits
)
{
    public const string DefaultOrigins = "http://localhost:8081,http://localhost:3001";

    public static AuthOptions Read(IConfiguration configuration) =>
        new(
            ReadBoolean(configuration, "Auth:AllowRegistration", true),
            ReadBoolean(configuration, "Auth:SecureCookies", false),
            ReadOrigins(configuration["Auth:AllowedOrigins"] ?? DefaultOrigins),
            ReadNetworks(configuration["Auth:TrustedProxies"] ?? ""),
            BackendOptions.ReadBounded(configuration, "Auth:RateLimitPermits", 40, 1, 10_000)
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
