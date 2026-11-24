using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Penny.Backend.Api.Configuration;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Abstractions.Security;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Application.Profiles;

namespace Penny.Backend.Api.Authentication;

// The OpenID Connect provider client: discovery,
// Authorization Code with S256 PKCE, a server-side code exchange (client_secret_post
// for confidential clients) and ID token validation, using Microsoft.IdentityModel for
// discovery/JWKS caching, signature, issuer, audience, lifetime and nonce checks. No
// token, code, secret or claim is logged or returned to clients.
public sealed class OidcProviderClient : IOidcProvider
{
    public const string HttpClientName = "oidc-provider";
    public const string Scope = OidcProviderOptions.DefaultScope;

    // openid-client's default clock tolerance.
    private static readonly TimeSpan ClockTolerance = TimeSpan.FromSeconds(30);

    private readonly OidcProviderOptions options;
    private readonly AppleClientSecret? appleSecret;
    private readonly IHttpClientFactory clients;
    private readonly ConfigurationManager<OpenIdConnectConfiguration> discovery;
    private readonly JsonWebTokenHandler tokens = new() { MapInboundClaims = false };

    public OidcProviderClient(
        OidcProviderOptions options,
        IHttpClientFactory clients,
        TimeProvider clock
    )
    {
        this.options = options;
        this.clients = clients;
        appleSecret = options.AppleClientSecret is { } apple ? new(apple, clock) : null;
        // Discovery and JWKS are cached and refreshed by IdentityModel; a failed fetch is
        // retried on a later request, so a provider outage does not need a restart.
        discovery = new ConfigurationManager<OpenIdConnectConfiguration>(
            options.Issuer.TrimEnd('/') + "/.well-known/openid-configuration",
            new OpenIdConnectConfigurationRetriever(),
            new OidcDocumentRetriever(clients)
        );
    }

    public string Id => options.Id;

    public async Task<string> CreateAuthorizationUrlAsync(
        StoredOidcAttempt attempt,
        CancellationToken cancellationToken
    )
    {
        var configuration = await DiscoverAsync(cancellationToken);
        var request = new OpenIdConnectMessage
        {
            IssuerAddress = RequireHttps(configuration.AuthorizationEndpoint).AbsoluteUri,
            ClientId = options.ClientId,
            RedirectUri = options.ProviderRedirectUri(RequireRedirect(attempt)),
            ResponseType = OpenIdConnectResponseType.Code,
            Scope = options.Scope,
            ResponseMode = options.ResponseMode,
            State = attempt.State,
            Nonce = attempt.Nonce,
            EnableTelemetryParameters = false,
        };
        request.SetParameter("code_challenge", CodeChallenge(attempt.CodeVerifier));
        request.SetParameter("code_challenge_method", "S256");
        return request.CreateAuthenticationRequestUrl();
    }

    public async Task<VerifiedOidcIdentity> ExchangeAsync(
        string callbackUrl,
        StoredOidcAttempt attempt,
        CancellationToken cancellationToken
    )
    {
        var parameters = CallbackParameters(callbackUrl, RequireRedirect(attempt));
        if (!string.Equals(Single(parameters, "state"), attempt.State, StringComparison.Ordinal))
            throw Rejected();
        // The user cancelled or the provider refused (RFC 6749 section 4.1.2.1).
        if (parameters.ContainsKey("error"))
            throw Rejected();
        var configuration = await DiscoverAsync(cancellationToken);
        // RFC 9207: a returned issuer must match, and is required when advertised.
        var issuer = Single(parameters, "iss");
        if (
            issuer is null
                ? configuration.AuthorizationResponseIssParameterSupported
                : !string.Equals(issuer, options.Issuer, StringComparison.Ordinal)
        )
            throw Rejected();
        var code = Single(parameters, "code");
        if (string.IsNullOrEmpty(code))
            throw Rejected();
        var (idToken, accessToken) = await RedeemAsync(
            configuration,
            code,
            attempt,
            cancellationToken
        );
        var claims = await ValidateIdTokenAsync(
            idToken,
            accessToken,
            attempt.Nonce,
            cancellationToken
        );
        var subject = Text(claims, "sub") ?? throw Rejected();
        // Some providers only expose email through UserInfo; its subject must match. A
        // provider without UserInfo (Apple) may leave the email out.
        var fromUserInfo =
            !claims.TryGetProperty("email", out _)
            && !string.IsNullOrEmpty(configuration.UserInfoEndpoint);
        var profile = fromUserInfo
            ? await UserInfoAsync(configuration, accessToken, subject, cancellationToken)
            : claims;
        var email = VerifiedEmail(profile);
        // Validated against the configured issuer; identities store the configured form.
        _ = Text(claims, "iss") ?? throw Rejected();
        var tokenIssuer = options.Issuer;
        // Apple sends the name only in its first-sign-in `user` parameter (MAZ-170).
        if (options.IsApple)
            return new(
                tokenIssuer,
                subject,
                email,
                AppleName(Single(parameters, "user")) is { } name ? new(name, null) : null
            );
        // Name and picture (MAZ-171): from the ID token, else from UserInfo. Reading UserInfo
        // only for them is best effort and never fails the sign-in.
        var person =
            HasProfile(claims) ? claims
            : fromUserInfo ? profile
            : await OptionalUserInfoAsync(configuration, accessToken, subject, cancellationToken);
        return new(
            tokenIssuer,
            subject,
            email,
            person is { } found ? ProviderProfileOf(found) : null
        );
    }

    public async Task<VerifiedOidcIdentity> VerifyNativeAsync(
        string idToken,
        StoredOidcAttempt attempt,
        string? name,
        CancellationToken cancellationToken
    )
    {
        if (options.NativeClientIds.Count == 0 || attempt.RedirectUri is not null)
            throw Rejected();
        var result = await ValidateAsync(idToken, options.NativeClientIds, cancellationToken);
        if (!result.IsValid || result.SecurityToken is not JsonWebToken token)
            throw Rejected();
        var claims = Payload(token);
        // The token must be the one the platform made for this attempt.
        if (
            !string.Equals(Text(claims, "nonce"), attempt.Nonce, StringComparison.Ordinal)
            || Text(claims, "sub") is not { Length: > 0 } subject
            || Text(claims, "iss") is null
        )
            throw Rejected();
        return new(
            options.Issuer,
            subject,
            VerifiedEmail(claims),
            name is not null ? new(name, null)
                : options.IsApple ? null
                : ProviderProfileOf(claims)
        );
    }

    // The provider's email when it says the email is verified; null when it sent none. An
    // email that is present but unverified or malformed fails the sign-in. Apple sends
    // `email_verified` as the string "true", and its private relay addresses
    // (`@privaterelay.appleid.com`) are real, verified addresses.
    private string? VerifiedEmail(JsonElement profile)
    {
        if (
            !profile.TryGetProperty("email", out var value)
            || value.ValueKind == JsonValueKind.Null
        )
            return null;
        var email = Credentials.NormalizeProviderEmail(
            value.ValueKind == JsonValueKind.String ? value.GetString() : null
        ) ?? throw Rejected();
        if (
            !profile.TryGetProperty("email_verified", out var verified)
            || !(
                verified.ValueKind == JsonValueKind.True
                || (
                    options.IsApple
                    && verified.ValueKind == JsonValueKind.String
                    && verified.GetString() == "true"
                )
            )
        )
            throw Rejected();
        return email;
    }

    // Apple's `user` form field: `{"name":{"firstName":"…","lastName":"…"},"email":"…"}`.
    // It is not signed, so only the display name is taken from it.
    private static string? AppleName(string? user)
    {
        if (string.IsNullOrEmpty(user) || user.Length > 4096)
            return null;
        try
        {
            using var document = JsonDocument.Parse(user);
            return
                document.RootElement.ValueKind == JsonValueKind.Object
                && document.RootElement.TryGetProperty("name", out var name)
                && name.ValueKind == JsonValueKind.Object
                ? DisplayName.FromProvider(null, Text(name, "firstName"), Text(name, "lastName"))
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string RequireRedirect(StoredOidcAttempt attempt) =>
        attempt.RedirectUri ?? throw Rejected();

    private static readonly string[] ProfileClaims =
    [
        "name",
        "given_name",
        "family_name",
        "picture",
    ];

    private static bool HasProfile(JsonElement claims) =>
        ProfileClaims.Any(name => Text(claims, name) is not null);

    private static ProviderProfile ProviderProfileOf(JsonElement claims) =>
        new(
            DisplayName.FromProvider(
                Text(claims, "name"),
                Text(claims, "given_name"),
                Text(claims, "family_name")
            ),
            Text(claims, "picture")
        );

    private async Task<JsonElement?> OptionalUserInfoAsync(
        OpenIdConnectConfiguration configuration,
        string accessToken,
        string subject,
        CancellationToken cancellationToken
    )
    {
        if (string.IsNullOrEmpty(configuration.UserInfoEndpoint))
            return null;
        try
        {
            return await UserInfoAsync(configuration, accessToken, subject, cancellationToken);
        }
        catch (Exception error)
            when (error is not OperationCanceledException
                || !cancellationToken.IsCancellationRequested
            )
        {
            return null;
        }
    }

    private async Task<OpenIdConnectConfiguration> DiscoverAsync(
        CancellationToken cancellationToken
    )
    {
        var configuration = await discovery.GetConfigurationAsync(cancellationToken);
        // The provider must advertise exactly the configured issuer.
        if (!string.Equals(configuration.Issuer, options.Issuer, StringComparison.Ordinal))
            throw Rejected();
        return configuration;
    }

    private async Task<(string IdToken, string AccessToken)> RedeemAsync(
        OpenIdConnectConfiguration configuration,
        string code,
        StoredOidcAttempt attempt,
        CancellationToken cancellationToken
    )
    {
        var form = new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = options.ProviderRedirectUri(RequireRedirect(attempt)),
            ["code_verifier"] = attempt.CodeVerifier,
            ["client_id"] = options.ClientId,
        };
        if ((options.ClientSecret ?? appleSecret?.Current()) is { } secret)
            form["client_secret"] = secret;
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            RequireHttps(configuration.TokenEndpoint)
        )
        {
            Content = new FormUrlEncodedContent(form),
        };
        var response = await SendJsonAsync(request, cancellationToken);
        if (
            Text(response, "access_token") is not { } accessToken
            || Text(response, "id_token") is not { } idToken
            || Text(response, "token_type") is null
        )
            throw Rejected();
        return (idToken, accessToken);
    }

    private async Task<JsonElement> ValidateIdTokenAsync(
        string idToken,
        string accessToken,
        string nonce,
        CancellationToken cancellationToken
    )
    {
        var result = await ValidateAsync(idToken, [options.ClientId], cancellationToken);
        if (!result.IsValid || result.SecurityToken is not JsonWebToken token)
            throw Rejected();
        // Required ID token claims, azp, at_hash (when present) and the nonce.
        new OpenIdConnectProtocolValidator
        {
            RequireNonce = true,
            RequireTimeStampInNonce = false,
            RequireStateValidation = false,
        }.ValidateTokenResponse(
            new OpenIdConnectProtocolValidationContext
            {
                ClientId = options.ClientId,
                Nonce = nonce,
                ProtocolMessage = new OpenIdConnectMessage
                {
                    IdToken = idToken,
                    AccessToken = accessToken,
                },
                ValidatedIdToken = new JwtSecurityToken(idToken),
            }
        );
        return Payload(token);
    }

    // Signature, issuer, audience and lifetime.
    private async Task<TokenValidationResult> ValidateAsync(
        string idToken,
        IReadOnlyList<string> audiences,
        CancellationToken cancellationToken
    )
    {
        var result = await tokens.ValidateTokenAsync(
            idToken,
            ValidationParameters(await DiscoverAsync(cancellationToken), audiences)
        );
        if (!result.IsValid && result.Exception is SecurityTokenSignatureKeyNotFoundException)
        {
            // The provider may have rotated its keys since the JWKS was cached.
            discovery.RequestRefresh();
            result = await tokens.ValidateTokenAsync(
                idToken,
                ValidationParameters(await DiscoverAsync(cancellationToken), audiences)
            );
        }
        return result;
    }

    private static JsonElement Payload(JsonWebToken token)
    {
        using var payload = JsonDocument.Parse(Base64UrlEncoder.Decode(token.EncodedPayload));
        return payload.RootElement.ValueKind == JsonValueKind.Object
            ? payload.RootElement.Clone()
            : throw Rejected();
    }

    private TokenValidationParameters ValidationParameters(
        OpenIdConnectConfiguration configuration,
        IReadOnlyList<string> audiences
    ) =>
        new()
        {
            // Google may write its issuer without the scheme in ID tokens.
            ValidIssuers =
                options.Issuer == OidcProviderOptions.GoogleIssuer
                    ? [options.Issuer, "accounts.google.com"]
                    : [options.Issuer],
            ValidAudiences = audiences,
            IssuerSigningKeys = configuration.SigningKeys,
            // openid-client's default id_token_signed_response_alg.
            ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
            RequireSignedTokens = true,
            RequireExpirationTime = true,
            ValidateLifetime = true,
            ClockSkew = ClockTolerance,
        };

    private async Task<JsonElement> UserInfoAsync(
        OpenIdConnectConfiguration configuration,
        string accessToken,
        string subject,
        CancellationToken cancellationToken
    )
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            RequireHttps(configuration.UserInfoEndpoint)
        );
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        var profile = await SendJsonAsync(request, cancellationToken);
        return string.Equals(Text(profile, "sub"), subject, StringComparison.Ordinal)
            ? profile
            : throw Rejected();
    }

    private async Task<JsonElement> SendJsonAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken
    )
    {
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        using var response = await clients
            .CreateClient(HttpClientName)
            .SendAsync(request, cancellationToken);
        if (
            response.StatusCode != HttpStatusCode.OK
            || response.Content.Headers.ContentType?.MediaType != "application/json"
        )
            throw Rejected();
        using var document = JsonDocument.Parse(
            await response.Content.ReadAsStringAsync(cancellationToken)
        );
        return document.RootElement.ValueKind == JsonValueKind.Object
            ? document.RootElement.Clone()
            : throw Rejected();
    }

    // Exact redirect matching: the callback is the attempt's redirect URI followed by a
    // query, without a fragment. Parameter names are case-sensitive, as in URLSearchParams.
    private static Dictionary<string, List<string>> CallbackParameters(
        string callbackUrl,
        string redirectUri
    )
    {
        var query = callbackUrl.IndexOf('?', StringComparison.Ordinal);
        if (
            query < 0
            || callbackUrl.Contains('#', StringComparison.Ordinal)
            || !string.Equals(callbackUrl[..query], redirectUri, StringComparison.Ordinal)
        )
            throw Rejected();
        var parameters = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var pair in new QueryStringEnumerable(callbackUrl[query..]))
        {
            var name = pair.DecodeName().ToString();
            if (!parameters.TryGetValue(name, out var values))
                parameters[name] = values = [];
            values.Add(pair.DecodeValue().ToString());
        }
        return parameters;
    }

    // Protocol parameters must not repeat.
    private static string? Single(Dictionary<string, List<string>> parameters, string name) =>
        !parameters.TryGetValue(name, out var values) ? null
        : values.Count == 1 ? values[0]
        : throw Rejected();

    private static string? Text(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static Uri RequireHttps(string? endpoint) =>
        Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps
            ? uri
            : throw Rejected();

    // RFC 7636 S256: BASE64URL(SHA-256(ASCII(code_verifier))), using the BCL hash and the
    // IdentityModel encoder.
    private static string CodeChallenge(string verifier) =>
        Base64UrlEncoder.Encode(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));

    // Deliberately uninformative; callers map every failure to one public message.
    private static InvalidOperationException Rejected() =>
        new("The OIDC provider response was rejected.");
}
