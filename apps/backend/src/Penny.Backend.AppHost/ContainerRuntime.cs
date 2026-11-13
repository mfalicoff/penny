using System.Diagnostics;

namespace Penny.Backend.AppHost;

public static class ContainerRuntime
{
    private const string Setting = "ASPIRE_CONTAINER_RUNTIME";

    // Aspire drives the Docker CLI unless told otherwise. The backend supports Podman too, so
    // pick Podman when there is no Docker CLI or when `docker` is Podman's compatibility shim
    // (podman-docker, NixOS virtualisation.podman.dockerCompat). An explicit setting wins.
    public static void SelectPodmanWhenDockerIsMissing()
    {
        if (Environment.GetEnvironmentVariable(Setting) is not null)
            return;
        var docker = Version("docker");
        if (
            (docker is null || docker.Contains("podman", StringComparison.OrdinalIgnoreCase))
            && Version("podman") is not null
        )
            Environment.SetEnvironmentVariable(Setting, "podman");
    }

    // The `--version` output, or null when the command cannot be started.
    private static string? Version(string command)
    {
        try
        {
            using var process = Process.Start(
                new ProcessStartInfo(command, "--version")
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                }
            );
            if (process is null)
                return null;
            var output = process.StandardOutput.ReadToEnd();
            process.WaitForExit();
            return process.ExitCode == 0 ? output : null;
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return null;
        }
    }
}
