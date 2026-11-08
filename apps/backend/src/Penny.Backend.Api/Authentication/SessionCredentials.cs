using System.Text.RegularExpressions;

namespace Penny.Backend.Api.Authentication;

// Legacy token extraction: a well-formed bearer token wins over the cookie, even when
// it is unknown or expired; a malformed Authorization header falls back to the cookie.
public static partial class SessionCredentials
{
    public const string CookieName = "penny_session";

    public static string? Read(HttpRequest request)
    {
        var bearer = BearerPattern().Match(request.Headers.Authorization.FirstOrDefault() ?? "");
        if (bearer.Success)
            return bearer.Groups[1].Value;
        var cookie = CookiePattern().Match(string.Join("; ", request.Headers.Cookie.ToArray()));
        return cookie.Success ? cookie.Groups[1].Value : null;
    }

    [GeneratedRegex("^Bearer ([a-f0-9]{64})\\z", RegexOptions.CultureInvariant)]
    private static partial Regex BearerPattern();

    [GeneratedRegex(
        "(?:^|;\\s*)penny_session=([a-f0-9]{64})(?:;|\\z)",
        RegexOptions.CultureInvariant
    )]
    private static partial Regex CookiePattern();
}
