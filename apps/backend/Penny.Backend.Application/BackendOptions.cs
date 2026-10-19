namespace Penny.Backend.Application;

public sealed record BackendOptions(
    string DataDirectory,
    long MaxRequestBodyBytes,
    int ShutdownTimeoutSeconds
)
{
    public const long DefaultMaxRequestBodyBytes = 20 * 1024 * 1024;

    public static BackendOptions Create(
        string? dataDirectory,
        string? maxRequestBodyBytes,
        string? shutdownTimeoutSeconds
    )
    {
        var path = string.IsNullOrWhiteSpace(dataDirectory) ? "data/backend" : dataDirectory;
        if (
            !long.TryParse(
                maxRequestBodyBytes ?? DefaultMaxRequestBodyBytes.ToString(),
                out var bodyLimit
            ) || bodyLimit is < 1 or > 100_000_000
        )
        {
            throw new InvalidOperationException(
                "Backend:MaxRequestBodyBytes must be between 1 and 100000000."
            );
        }

        if (
            !int.TryParse(shutdownTimeoutSeconds ?? "30", out var shutdownSeconds)
            || shutdownSeconds is < 1 or > 300
        )
        {
            throw new InvalidOperationException(
                "Backend:ShutdownTimeoutSeconds must be between 1 and 300."
            );
        }

        return new BackendOptions(Path.GetFullPath(path), bodyLimit, shutdownSeconds);
    }
}
