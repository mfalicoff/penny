using System.Diagnostics;

namespace Penny.Backend.IntegrationTests.Infrastructure;

internal static class MaintenanceProcess
{
    public static async Task<(int ExitCode, string Output, string Error)> RunAsync(
        string? connection,
        string[] arguments,
        CancellationToken ct,
        IReadOnlyDictionary<string, string>? environment = null
    )
    {
        var entry = typeof(Program).Assembly.Location;
        var start = new ProcessStartInfo(
            Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet"
        )
        {
            WorkingDirectory = System.IO.Path.GetDirectoryName(entry)!,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        start.ArgumentList.Add(entry);
        foreach (var argument in arguments)
            start.ArgumentList.Add(argument);
        if (connection is not null)
            start.Environment["ConnectionStrings__Migration"] = connection;
        foreach (var (name, value) in environment ?? new Dictionary<string, string>())
            start.Environment[name] = value;
        using var process = Process.Start(start)!;
        var output = process.StandardOutput.ReadToEndAsync(ct);
        var error = process.StandardError.ReadToEndAsync(ct);
        try
        {
            await process.WaitForExitAsync(ct).WaitAsync(TimeSpan.FromSeconds(30), ct);
        }
        finally
        {
            if (!process.HasExited)
                process.Kill(entireProcessTree: true);
        }
        return (process.ExitCode, await output, await error);
    }
}
