namespace Penny.Backend.Api.Configuration;

// Legacy equivalents: OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URIS,
// OIDC_LABEL and OIDC_ALLOW_REGISTRATION (server/infrastructure/oidc.ts `oidcFromEnv`
// and the URL checks of `createOidcProvider`). OIDC is off unless an issuer or client
// ID is set; empty values count as unset, as in the legacy server.
public sealed record OidcOptions(
    string Issuer,
    string ClientId,
    string? ClientSecret,
    IReadOnlyList<string> RedirectUris,
    string Label,
    bool AllowRegistration
)
{
    public const string DefaultLabel = "Single sign-on";
    public const string NativeRedirectUri = "penny://auth/callback";
    private const int MaxUriLength = 2048;

    public override string ToString() => "OIDC options (client secret redacted)";

    public static OidcOptions? Read(IConfiguration configuration)
    {
        var issuer = Value(configuration, "Oidc:Issuer");
        var clientId = Value(configuration, "Oidc:ClientId");
        if (issuer is null && clientId is null)
            return null;
        var redirectUris = Value(configuration, "Oidc:RedirectUris");
        if (issuer is null || clientId is null || redirectUris is null)
            throw new InvalidOperationException(
                "Oidc:Issuer, Oidc:ClientId and Oidc:RedirectUris are required when OIDC is configured."
            );
        if (!IsIssuer(issuer))
            throw new InvalidOperationException(
                "Oidc:Issuer must be an HTTPS issuer URL without credentials, query or fragment."
            );
        List<string> redirects =
        [
            .. redirectUris.Split(
                ',',
                StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries
            ),
        ];
        if (redirects.Count == 0 || !redirects.All(IsRedirectUri))
            throw new InvalidOperationException(
                "Oidc:RedirectUris must use HTTPS, localhost HTTP, or penny://auth/callback, without query strings or fragments."
            );
        return new(
            issuer,
            clientId,
            Value(configuration, "Oidc:ClientSecret"),
            redirects,
            Value(configuration, "Oidc:Label") ?? DefaultLabel,
            ReadAllowRegistration(configuration)
        );
    }

    private static string? Value(IConfiguration configuration, string key) =>
        configuration[key] is { Length: > 0 } value ? value : null;

    // Unlike the legacy `=== "true"` check, a misspelled value fails startup instead of
    // silently disabling registration.
    private static bool ReadAllowRegistration(IConfiguration configuration)
    {
        var value = Value(configuration, "Oidc:AllowRegistration");
        if (value is null)
            return false;
        return bool.TryParse(value, out var parsed)
            ? parsed
            : throw new InvalidOperationException("Oidc:AllowRegistration must be true or false.");
    }

    private static bool IsIssuer(string issuer) =>
        issuer.Length <= MaxUriLength
        && IsPlainAbsolute(issuer, out var uri)
        && uri.Scheme == Uri.UriSchemeHttps;

    private static bool IsRedirectUri(string redirectUri) =>
        redirectUri.Length <= MaxUriLength
        && IsPlainAbsolute(redirectUri, out var uri)
        && (
            uri.Scheme == Uri.UriSchemeHttps
            || redirectUri == NativeRedirectUri
            || (uri.Scheme == Uri.UriSchemeHttp && uri.Host is "localhost" or "127.0.0.1")
        );

    private static bool IsPlainAbsolute(string value, out Uri uri) =>
        Uri.TryCreate(value, UriKind.Absolute, out uri!)
        && !value.Contains('?', StringComparison.Ordinal)
        && !value.Contains('#', StringComparison.Ordinal)
        && uri.UserInfo.Length == 0;
}
