namespace Penny.Backend.Api.Contracts;

public sealed record ServerInfo(string Name, string Version)
{
    /// <summary>
    /// The release version /api/info reports. It follows package.json: release-please updates
    /// this line, and the full-stack comparison checks it against the legacy API.
    /// </summary>
    public const string CurrentVersion = "1.0.1"; // x-release-please-version
}
