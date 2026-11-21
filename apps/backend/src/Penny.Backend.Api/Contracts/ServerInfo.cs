namespace Penny.Backend.Api.Contracts;

public sealed record ServerInfo(string Name, string Version)
{
    /// <summary>
    /// The release version /api/info reports. It follows apps/ios/Configuration/Version.xcconfig:
    /// release-please updates both lines, and scripts/check-version.mjs checks they match.
    /// </summary>
    public const string CurrentVersion = "3.0.0"; // x-release-please-version
}
