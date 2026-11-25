using System.Text.RegularExpressions;

namespace Penny.Backend.Api.Configuration;

// One configured OpenID Connect provider (MAZ-170). `RedirectUris` are the app addresses the
// sign-in returns to. `CallbackUri`, when set, is the address the provider itself redirects to:
// this API's `/api/auth/oidc/callback/<id>`, which hands the response on to the app's
// redirect. Providers that post their response (Apple) or refuse app addresses need it.
// `NativeClientIds` are the audiences of ID tokens an app gets from the platform's own
// sign-in (Sign in with Apple on iOS: the bundle id).
public sealed partial record OidcProviderOptions(
    string Id,
    string Issuer,
    string ClientId,
    string? ClientSecret,
    AppleClientSecretOptions? AppleClientSecret,
    IReadOnlyList<string> RedirectUris,
    string? CallbackUri,
    string Scope,
    string Label,
    string Icon,
    bool AllowRegistration,
    IReadOnlyList<string> NativeClientIds,
    int Order
)
{
    public const string DefaultLabel = "Single sign-on";
    public const string NativeRedirectUri = "penny://auth/callback";
    public const string DefaultScope = "openid email profile";
    public const string AppleIssuer = "https://appleid.apple.com";
    public const string AppleScope = "openid email name";
    public const string GoogleIssuer = "https://accounts.google.com";
    public const string CallbackPath = "/api/auth/oidc/callback/";
    private const int MaxUriLength = 2048;

    // Apple posts its response (`response_mode=form_post`), sends the name only in that post
    // and may send `email_verified` as a string.
    public bool IsApple => Issuer == AppleIssuer;

    public string? ResponseMode => IsApple ? "form_post" : null;

    // The redirect_uri sent to the provider for an attempt that returns to `redirectUri`.
    public string ProviderRedirectUri(string redirectUri) => CallbackUri ?? redirectUri;

    public override string ToString() => $"OIDC provider {Id} (client secret redacted)";

    public static OidcProviderOptions? Read(IConfiguration section, string prefix, string id)
    {
        var issuer = Value(section, "Issuer");
        var clientId = Value(section, "ClientId");
        if (issuer is null && clientId is null)
            return null;
        var redirectUris = Value(section, "RedirectUris");
        if (issuer is null || clientId is null || redirectUris is null)
            throw new InvalidOperationException(
                $"{prefix}:Issuer, {prefix}:ClientId and {prefix}:RedirectUris are required when OIDC is configured."
            );
        if (!IsIssuer(issuer))
            throw new InvalidOperationException(
                $"{prefix}:Issuer must be an HTTPS issuer URL without credentials, query or fragment."
            );
        var redirects = List(redirectUris);
        if (redirects.Count == 0 || !redirects.All(IsRedirectUri))
            throw new InvalidOperationException(
                $"{prefix}:RedirectUris must use HTTPS, localhost HTTP, or penny://auth/callback, without query strings or fragments."
            );
        var callbackUri = Value(section, "CallbackUri");
        if (callbackUri is not null && !IsCallbackUri(callbackUri, id))
            throw new InvalidOperationException(
                $"{prefix}:CallbackUri must be this server's HTTPS (or localhost HTTP) address ending in {CallbackPath}{id}, without query or fragment."
            );
        var apple = issuer == AppleIssuer;
        if (apple && callbackUri is null)
            throw new InvalidOperationException(
                $"{prefix}:CallbackUri is required for Apple, which posts its response to the server."
            );
        var secret = Value(section, "ClientSecret");
        var generated = AppleClientSecretOptions.Read(section, prefix, clientId);
        if (generated is not null && secret is not null)
            throw new InvalidOperationException(
                $"{prefix}:ClientSecret and {prefix}:TeamId, KeyId and PrivateKey are alternatives. Set one of them."
            );
        if (apple && generated is null && secret is null)
            throw new InvalidOperationException(
                $"{prefix}:TeamId, {prefix}:KeyId and {prefix}:PrivateKey (or PrivateKeyFile) are required for Apple."
            );
        var scope =
            Value(section, "Scopes") is { } scopes
                ? string.Join(' ', scopes.Split([' ', ','], SplitOptions))
            : apple ? AppleScope
            : DefaultScope;
        if (
            !scope.Split(' ').Contains("openid", StringComparer.Ordinal)
            || !ScopeText().IsMatch(scope)
        )
            throw new InvalidOperationException(
                $"{prefix}:Scopes must be space- or comma-separated scope names including openid."
            );
        var icon = Value(section, "Icon") ?? DefaultIcon(issuer);
        if (!IconName().IsMatch(icon))
            throw new InvalidOperationException(
                $"{prefix}:Icon must be 1 to 32 lowercase letters, digits or '-', for example google, apple or sso."
            );
        var label = Value(section, "Label") ?? DefaultLabelFor(issuer);
        if (label.Length > 60 || label.Any(char.IsControl))
            throw new InvalidOperationException(
                $"{prefix}:Label must be at most 60 characters, without control characters."
            );
        var native = Value(section, "NativeClientIds") is { } nativeIds ? List(nativeIds) : [];
        if (native.Any(value => value.Length > 255 || value.Any(char.IsWhiteSpace)))
            throw new InvalidOperationException(
                $"{prefix}:NativeClientIds must be comma-separated client ids (bundle ids)."
            );
        return new(
            id,
            issuer,
            clientId,
            secret,
            generated,
            redirects,
            callbackUri,
            scope,
            label,
            icon,
            ReadBoolean(section, prefix, "AllowRegistration"),
            native,
            ReadOrder(section, prefix)
        );
    }

    private const StringSplitOptions SplitOptions =
        StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries;

    private static List<string> List(string value) => [.. value.Split(',', SplitOptions)];

    private static string DefaultIcon(string issuer) =>
        issuer switch
        {
            AppleIssuer => "apple",
            GoogleIssuer => "google",
            _ => "sso",
        };

    private static string DefaultLabelFor(string issuer) =>
        issuer switch
        {
            AppleIssuer => "Apple",
            GoogleIssuer => "Google",
            _ => DefaultLabel,
        };

    internal static string? Value(IConfiguration section, string key) =>
        section[key] is { Length: > 0 } value ? value : null;

    // A misspelled value fails startup instead of silently disabling registration.
    private static bool ReadBoolean(IConfiguration section, string prefix, string key)
    {
        var value = Value(section, key);
        if (value is null)
            return false;
        return bool.TryParse(value, out var parsed)
            ? parsed
            : throw new InvalidOperationException($"{prefix}:{key} must be true or false.");
    }

    private static int ReadOrder(IConfiguration section, string prefix)
    {
        var value = Value(section, "Order");
        if (value is null)
            return 0;
        return int.TryParse(value, out var parsed) && parsed is >= -1000 and <= 1000
            ? parsed
            : throw new InvalidOperationException(
                $"{prefix}:Order must be a whole number from -1000 to 1000."
            );
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
            || IsLoopbackHttp(uri)
        );

    private static bool IsCallbackUri(string callbackUri, string id) =>
        callbackUri.Length <= MaxUriLength
        && IsPlainAbsolute(callbackUri, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttps || IsLoopbackHttp(uri))
        && uri.AbsolutePath.EndsWith(CallbackPath + id, StringComparison.Ordinal);

    private static bool IsLoopbackHttp(Uri uri) =>
        uri.Scheme == Uri.UriSchemeHttp && uri.Host is "localhost" or "127.0.0.1";

    private static bool IsPlainAbsolute(string value, out Uri uri) =>
        Uri.TryCreate(value, UriKind.Absolute, out uri!)
        && !value.Contains('?', StringComparison.Ordinal)
        && !value.Contains('#', StringComparison.Ordinal)
        && uri.UserInfo.Length == 0;

    [GeneratedRegex("^[a-z0-9-]{1,32}$")]
    private static partial Regex IconName();

    [GeneratedRegex(@"^[\x21\x23-\x5B\x5D-\x7E]+( [\x21\x23-\x5B\x5D-\x7E]+)*$")]
    private static partial Regex ScopeText();
}
