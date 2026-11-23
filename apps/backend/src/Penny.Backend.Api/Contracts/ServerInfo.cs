namespace Penny.Backend.Api.Contracts;

/// <param name="PrivacyPolicyUrl">
/// The operator's privacy policy (`Legal__PrivacyPolicyUrl`), or null when the server
/// publishes none. Clients open it in the browser and never build the policy in.
/// </param>
public sealed record ServerInfo(string Name, string Version, string? PrivacyPolicyUrl)
{
    /// <summary>
    /// The release version /api/info reports. It follows apps/ios/Configuration/Version.xcconfig:
    /// release-please updates both lines, and scripts/check-version.mjs checks they match.
    /// </summary>
    public const string CurrentVersion = "2.0.0"; // x-release-please-version
}
