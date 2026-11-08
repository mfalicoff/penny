using System.Globalization;

namespace Penny.Backend.Api.Configuration;

public sealed record BackendOptions(
    long MaxRequestBodyBytes,
    int RequestTimeoutSeconds,
    int ShutdownTimeoutSeconds
)
{
    public static BackendOptions Read(IConfiguration configuration) =>
        new(
            ReadBounded(
                configuration,
                "Backend:MaxRequestBodyBytes",
                20 * 1024 * 1024,
                1,
                100_000_000
            ),
            ReadBounded(configuration, "Backend:RequestTimeoutSeconds", 30, 1, 300),
            ReadBounded(configuration, "Backend:ShutdownTimeoutSeconds", 30, 1, 300)
        );

    public static int ReadBounded(
        IConfiguration configuration,
        string key,
        int fallback,
        int minimum,
        int maximum
    )
    {
        var value = configuration[key];
        if (value is null)
            return fallback;
        if (
            !int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            || parsed < minimum
            || parsed > maximum
        )
            throw new InvalidOperationException(
                $"{key} must be an integer between {minimum} and {maximum}."
            );
        return parsed;
    }
}
