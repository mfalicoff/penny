using System.Globalization;

namespace Penny.Backend.Api.Commands;

// MAZ-63: container health check without curl or a shell. `health-probe` asks this
// container's own `/api/ready` (port from ASPNETCORE_HTTP_PORTS, default 8080) and
// exits 0 only on 200. It reads no configuration and prints no response body.
internal static class HealthProbeCommand
{
    public const string Name = "health-probe";

    public static async Task<int> RunAsync(string[] args)
    {
        var path = args is [_, var requested] ? requested : "/api/ready";
        if (path is not ("/api/ready" or "/api/health"))
        {
            await Console.Error.WriteLineAsync("Usage: health-probe [/api/ready|/api/health]");
            return 2;
        }
        var port = (Environment.GetEnvironmentVariable("ASPNETCORE_HTTP_PORTS") ?? "8080")
            .Split([';', ','], StringSplitOptions.RemoveEmptyEntries)
            .Select(value =>
                int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var p)
                    ? p
                    : 0
            )
            .FirstOrDefault(p => p is > 0 and < 65536, 8080);
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(4) };
        try
        {
            using var response = await client.GetAsync(
                new Uri($"http://127.0.0.1:{port.ToString(CultureInfo.InvariantCulture)}{path}")
            );
            Console.WriteLine($"{path}: {(int)response.StatusCode}");
            return response.IsSuccessStatusCode ? 0 : 1;
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
        {
            Console.WriteLine($"{path}: unreachable");
            return 1;
        }
    }
}
