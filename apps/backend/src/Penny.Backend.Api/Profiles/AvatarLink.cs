namespace Penny.Backend.Api.Profiles;

// The same-origin URL of a person's picture. The version changes with every picture, so a
// client may cache a URL for good; the session still decides who may load it.
public static class AvatarLink
{
    public static string? UrlFor(string userId, string? version) =>
        version is null ? null : $"/api/users/{Uri.EscapeDataString(userId)}/avatar?v={version}";
}
