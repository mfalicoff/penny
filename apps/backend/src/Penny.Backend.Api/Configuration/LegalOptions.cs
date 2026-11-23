namespace Penny.Backend.Api.Configuration;

// The operator's legal pages, published on GET /api/info so every client links the
// policy of the server it talks to rather than a URL built into the app.
// `Legal__PrivacyPolicyUrl` is an absolute http:// or https:// URL without credentials;
// unset means the server publishes none and clients show no link. The value is public,
// so startup errors may name the setting but never echo the value.
public sealed record LegalOptions(string? PrivacyPolicyUrl)
{
    public const string PrivacyPolicyUrlSetting = "Legal__PrivacyPolicyUrl";

    public static LegalOptions Read(IConfiguration configuration) =>
        new(ReadUrl(configuration, "Legal:PrivacyPolicyUrl", PrivacyPolicyUrlSetting));

    private static string? ReadUrl(IConfiguration configuration, string key, string setting)
    {
        var value = configuration[key];
        if (value is null)
            return null;
        value = value.Trim();
        if (
            value.Length is 0 or > 2048
            || !Uri.TryCreate(value, UriKind.Absolute, out var url)
            || url.Scheme is not ("http" or "https")
            || url.UserInfo.Length > 0
            || url.Host.Length == 0
        )
            throw new InvalidOperationException(
                $"{setting} must be an absolute http:// or https:// URL of at most 2048 characters, without credentials."
            );
        return url.AbsoluteUri;
    }
}
