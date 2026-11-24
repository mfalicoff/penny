namespace Penny.Backend.Api.Contracts;

/// <param name="PrivacyPolicyUrl">
/// The operator's privacy policy (`Legal__PrivacyPolicyUrl`), or null when the server
/// publishes none. Clients open it in the browser and never build the policy in.
/// </param>
/// <param name="EmailEnabled">
/// Whether the server sends email (MAZ-124, `Email__Smtp__Host`). Clients show "check your
/// email" flows when true and fall back to codes when false or absent.
/// </param>
public sealed record ServerInfo(
    string Name,
    string Version,
    string? PrivacyPolicyUrl,
    bool EmailEnabled
)
{
    /// <summary>
    /// The release version /api/info reports. It follows apps/ios/Configuration/Version.xcconfig:
    /// release-please updates both lines, and scripts/check-version.mjs checks they match.
    /// </summary>
    public const string CurrentVersion = "3.0.0"; // x-release-please-version
}
