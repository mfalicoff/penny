using System.Collections.Concurrent;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Penny.Backend.Api.Authentication;
using Xunit;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// A deterministic local OpenID provider on loopback Kestrel with HTTPS. The API under
// test reaches it through its named provider HttpClient, whose connections are routed
// to this listener and whose TLS is pinned to this throwaway certificate, so issuer
// URLs look real and no external network is used. Keys are generated per run.
public sealed class FakeOidcProvider : IAsyncLifetime
{
    public const string Issuer = "https://issuer.example.test";
    public const string ClientId = "penny-web";
    public const string ClientSecret = "synthetic-client-secret";
    public const string WebRedirect = "https://penny.example.test/auth/callback";
    public const string NativeRedirect = "penny://auth/callback";

    // MAZ-170: the same listener also plays Apple (form_post, a generated ES256 client secret,
    // no UserInfo, string `email_verified`) and a second standard provider. Each issuer is
    // told apart by the request host; every host is routed to this listener.
    public const string AppleIssuer = "https://appleid.apple.com";
    public const string AppleClientId = "test.penny.web";
    public const string AppleNativeClientId = "test.penny.app";
    public const string AppleTeamId = "TEAM123456";
    public const string AppleKeyId = "KEY1234567";
    public const string SecondIssuer = "https://second.example.test";
    public const string SecondClientId = "penny-second";
    public const string ApiOrigin = "https://penny.example.test";
    public const string AppleCallback = ApiOrigin + "/api/auth/oidc/callback/apple";

    // The provider's `picture` URLs (MAZ-171); any path under /picture serves `Picture`.
    public const string PictureUrl = Issuer + "/picture/1.png";
    private const string KeyId = "synthetic-key";

    private readonly RSA signingKey = RSA.Create(2048);
    private readonly RSA wrongKey = RSA.Create(2048);
    private readonly ECDsa appleClientKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private readonly ConcurrentDictionary<
        string,
        (FakeOidcGrant Grant, string Issuer, string Nonce, string Challenge, string RedirectUri)
    > codes = new();
    private readonly ConcurrentDictionary<string, FakeOidcGrant> accessTokens = new();
    private X509Certificate2 certificate = null!;
    private WebApplication provider = null!;
    private int port;
    private int tokenRequests;
    private int pictureRequests;

    public int TokenRequests => Volatile.Read(ref tokenRequests);
    public int PictureRequests => Volatile.Read(ref pictureRequests);
    public byte[]? Picture { get; set; }
    public bool Available { get; set; } = true;
    public string DiscoveryIssuer { get; set; } = Issuer;
    public bool SendsIssuer { get; set; }

    public async ValueTask InitializeAsync()
    {
        certificate = CreateCertificate();
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(server =>
            server.Listen(IPAddress.Loopback, 0, listen => listen.UseHttps(certificate))
        );
        provider = builder.Build();
        provider.Run(HandleAsync);
        await provider.StartAsync(TestContext.Current.CancellationToken);
        var address = provider
            .Services.GetRequiredService<IServer>()
            .Features.Get<IServerAddressesFeature>()!
            .Addresses.Single();
        port = new Uri(address).Port;
    }

    public async ValueTask DisposeAsync()
    {
        if (provider is not null)
            await provider.DisposeAsync();
        certificate?.Dispose();
        signingKey.Dispose();
        wrongKey.Dispose();
        appleClientKey.Dispose();
    }

    public void Reset()
    {
        codes.Clear();
        accessTokens.Clear();
        Interlocked.Exchange(ref tokenRequests, 0);
        Interlocked.Exchange(ref pictureRequests, 0);
        Picture = null;
        Available = true;
        DiscoveryIssuer = Issuer;
        SendsIssuer = false;
    }

    // Settings for an API host that trusts this provider.
    public static Dictionary<string, string> Settings(bool allowRegistration = true) =>
        new()
        {
            ["Oidc:Issuer"] = Issuer,
            ["Oidc:ClientId"] = ClientId,
            ["Oidc:ClientSecret"] = ClientSecret,
            ["Oidc:RedirectUris"] = $"{WebRedirect}, {NativeRedirect}",
            ["Oidc:Label"] = "Synthetic SSO",
            ["Oidc:AllowRegistration"] = allowRegistration ? "true" : "false",
            ["Backend:MaxRequestBodyBytes"] = "65536",
            ["Backend:RequestTimeoutSeconds"] = "15",
        };

    // MAZ-170: the single-provider settings (provider `sso`) plus Apple, relayed through the
    // API's callback and accepting native ID tokens, and a second standard provider.
    public Dictionary<string, string> MultiSettings(bool allowRegistration = true)
    {
        var settings = Settings(allowRegistration);
        var registration = allowRegistration ? "true" : "false";
        foreach (
            var (key, value) in new Dictionary<string, string>
            {
                ["apple:Issuer"] = AppleIssuer,
                ["apple:ClientId"] = AppleClientId,
                ["apple:RedirectUris"] = $"{WebRedirect}, {NativeRedirect}",
                ["apple:CallbackUri"] = AppleCallback,
                ["apple:TeamId"] = AppleTeamId,
                ["apple:KeyId"] = AppleKeyId,
                ["apple:PrivateKey"] = appleClientKey.ExportPkcs8PrivateKeyPem(),
                ["apple:NativeClientIds"] = AppleNativeClientId,
                ["apple:AllowRegistration"] = registration,
                ["apple:Order"] = "1",
                ["second:Issuer"] = SecondIssuer,
                ["second:ClientId"] = SecondClientId,
                ["second:ClientSecret"] = ClientSecret,
                ["second:RedirectUris"] = WebRedirect,
                ["second:Label"] = "Second provider",
                ["second:AllowRegistration"] = registration,
                ["second:Order"] = "2",
            }
        )
            settings["Oidc:Providers:" + key] = value;
        return settings;
    }

    // An ID token as the platform's own sign-in hands it to the app (Sign in with Apple).
    public string NativeIdToken(
        string nonce,
        FakeOidcGrant? grant = null,
        string issuer = AppleIssuer,
        string audience = AppleNativeClientId
    ) => IdToken(grant ?? new FakeOidcGrant(), issuer, audience, nonce);

    public TestApiFactory CreateApi(
        string connectionString,
        IReadOnlyDictionary<string, string>? settings = null,
        Action<IServiceCollection>? configure = null
    ) => new(connectionString, settings ?? Settings(), services =>
        {
            services
                .AddHttpClient(OidcProviderClient.HttpClientName)
                .ConfigurePrimaryHttpMessageHandler(CreateHandler);
            services
                .AddHttpClient(ProviderPictureClient.HttpClientName)
                .ConfigurePrimaryHttpMessageHandler(CreateHandler);
            configure?.Invoke(services);
        });

    // Plays the user approving sign-in at the provider and returns the redirect the
    // app receives. Asserts the request is a code flow with S256 PKCE.
    public string Authorize(string authorizationUrl, FakeOidcGrant? grant = null)
    {
        var (issuer, redirectUri, parameters) = Approve(authorizationUrl, grant);
        if (issuer == AppleIssuer)
            throw new InvalidOperationException("Apple posts its response; use AuthorizePost.");
        return QueryHelpers.AddQueryString(redirectUri, parameters);
    }

    // Plays Apple: the response is a form the browser posts to the configured callback.
    // `user` is the first-sign-in JSON Apple adds with the person's name.
    public (string CallbackUri, Dictionary<string, string?> Form) AuthorizePost(
        string authorizationUrl,
        FakeOidcGrant? grant = null,
        string? user = null
    )
    {
        var (issuer, redirectUri, parameters) = Approve(authorizationUrl, grant);
        if (issuer != AppleIssuer)
            throw new InvalidOperationException("Only Apple posts its response.");
        if (user is not null)
            parameters["user"] = user;
        return (redirectUri, parameters);
    }

    private (string Issuer, string RedirectUri, Dictionary<string, string?> Parameters) Approve(
        string authorizationUrl,
        FakeOidcGrant? grant
    )
    {
        var url = new Uri(authorizationUrl);
        var issuer = $"https://{url.Host}";
        if (!authorizationUrl.StartsWith(issuer + "/authorize?", StringComparison.Ordinal))
            throw new InvalidOperationException("Unexpected authorization endpoint.");
        var query = QueryHelpers.ParseQuery(url.Query);
        var apple = issuer == AppleIssuer;
        if (
            query["response_type"] != "code"
            || query["client_id"] != ClientIdOf(issuer)
            || query["scope"] != (apple ? "openid email name" : OidcProviderClient.Scope)
            || query["code_challenge_method"] != "S256"
            || (apple ? query["response_mode"] != "form_post" : query.ContainsKey("response_mode"))
        )
            throw new InvalidOperationException("Unexpected authorization request.");
        var code = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
        var redirectUri = query["redirect_uri"].ToString();
        codes[code] = (
            grant ?? new FakeOidcGrant(),
            issuer,
            query["nonce"].ToString(),
            query["code_challenge"].ToString(),
            redirectUri
        );
        var parameters = new Dictionary<string, string?>
        {
            ["code"] = code,
            ["state"] = query["state"].ToString(),
        };
        if (SendsIssuer)
            parameters["iss"] = issuer;
        return (issuer, redirectUri, parameters);
    }

    private static string ClientIdOf(string issuer) =>
        issuer switch
        {
            AppleIssuer => AppleClientId,
            SecondIssuer => SecondClientId,
            _ => ClientId,
        };

    // Apple's client secret is an ES256 JWT signed with the operator's key, for this client.
    private bool IsClientSecret(string issuer, string? secret)
    {
        if (issuer != AppleIssuer)
            return secret == ClientSecret;
        if (secret is null)
            return false;
        var result = new JsonWebTokenHandler()
            .ValidateTokenAsync(
                secret,
                new TokenValidationParameters
                {
                    ValidIssuer = AppleTeamId,
                    ValidAudience = AppleIssuer,
                    IssuerSigningKey = new ECDsaSecurityKey(appleClientKey),
                    ValidAlgorithms = [SecurityAlgorithms.EcdsaSha256],
                    ValidateLifetime = false,
                }
            )
            .GetAwaiter()
            .GetResult();
        return result.IsValid
            && result.SecurityToken is JsonWebToken token
            && token.Subject == AppleClientId
            && token.Kid == AppleKeyId;
    }

    private HttpMessageHandler CreateHandler() =>
        new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            ConnectCallback = async (_, cancellationToken) =>
            {
                var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
                try
                {
                    await socket.ConnectAsync(IPAddress.Loopback, port, cancellationToken);
                    return new NetworkStream(socket, ownsSocket: true);
                }
                catch
                {
                    socket.Dispose();
                    throw;
                }
            },
            SslOptions = new SslClientAuthenticationOptions
            {
                RemoteCertificateValidationCallback = (_, presented, _, _) =>
                    presented is not null
                    && presented.GetCertHash().AsSpan().SequenceEqual(certificate.GetCertHash()),
            },
        };

    private async Task HandleAsync(HttpContext context)
    {
        var ct = context.RequestAborted;
        var issuer = $"https://{context.Request.Host.Host}";
        switch (context.Request.Path.Value)
        {
            case "/.well-known/openid-configuration" when Available:
                var document = new Dictionary<string, object>
                {
                    ["issuer"] = issuer == Issuer ? DiscoveryIssuer : issuer,
                    ["authorization_endpoint"] = issuer + "/authorize",
                    ["token_endpoint"] = issuer + "/token",
                    ["jwks_uri"] = issuer + "/jwks",
                    ["response_types_supported"] = new[] { "code" },
                    ["subject_types_supported"] = new[] { "public" },
                    ["id_token_signing_alg_values_supported"] = new[] { "RS256" },
                    ["code_challenge_methods_supported"] = new[] { "S256" },
                    ["authorization_response_iss_parameter_supported"] = SendsIssuer,
                };
                // Apple has no UserInfo endpoint.
                if (issuer != AppleIssuer)
                    document["userinfo_endpoint"] = issuer + "/userinfo";
                await context.Response.WriteAsJsonAsync(document, ct);
                return;
            case "/jwks":
                var key = signingKey.ExportParameters(false);
                await context.Response.WriteAsJsonAsync(
                    new
                    {
                        keys = new[]
                        {
                            new
                            {
                                kty = "RSA",
                                use = "sig",
                                alg = "RS256",
                                kid = KeyId,
                                n = Base64UrlEncoder.Encode(key.Modulus),
                                e = Base64UrlEncoder.Encode(key.Exponent),
                            },
                        },
                    },
                    ct
                );
                return;
            case "/token" when HttpMethods.IsPost(context.Request.Method):
                await TokenAsync(context);
                return;
            case "/userinfo":
                await UserInfoAsync(context);
                return;
            case { } path when path.StartsWith("/picture/", StringComparison.Ordinal):
                Interlocked.Increment(ref pictureRequests);
                if (Picture is not { } picture)
                {
                    context.Response.StatusCode = 404;
                    return;
                }
                context.Response.ContentType = "image/png";
                await context.Response.Body.WriteAsync(picture, ct);
                return;
            default:
                context.Response.StatusCode = 503;
                return;
        }
    }

    private async Task TokenAsync(HttpContext context)
    {
        Interlocked.Increment(ref tokenRequests);
        var form = await context.Request.ReadFormAsync(context.RequestAborted);
        // Codes are single-use, bound to the client, redirect URI and PKCE challenge.
        if (
            form["grant_type"] != "authorization_code"
            || !codes.TryRemove(form["code"].ToString(), out var issued)
            || issued.Issuer != $"https://{context.Request.Host.Host}"
            || form["client_id"] != ClientIdOf(issued.Issuer)
            || !IsClientSecret(
                issued.Issuer,
                form["client_secret"].ToString() is { Length: > 0 } secret ? secret : null
            )
            || form["redirect_uri"] != issued.RedirectUri
            || Base64UrlEncoder.Encode(
                SHA256.HashData(Encoding.ASCII.GetBytes(form["code_verifier"].ToString()))
            ) != issued.Challenge
        )
        {
            context.Response.StatusCode = 400;
            await context.Response.WriteAsJsonAsync(
                new { error = "invalid_grant" },
                context.RequestAborted
            );
            return;
        }
        var idToken = IdToken(issued.Grant, issued.Issuer, ClientIdOf(issued.Issuer), issued.Nonce);
        var accessToken = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
        accessTokens[accessToken] = issued.Grant;
        await context.Response.WriteAsJsonAsync(
            new
            {
                token_type = "Bearer",
                access_token = accessToken,
                id_token = idToken,
                expires_in = 300,
            },
            context.RequestAborted
        );
    }

    private string IdToken(FakeOidcGrant grant, string issuer, string audience, string nonce)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var apple = issuer == AppleIssuer;
        var claims = new Dictionary<string, object?>
        {
            ["iss"] = issuer,
            ["sub"] = grant.Subject,
            ["aud"] = audience,
            ["iat"] = now,
            ["exp"] = now + 300,
            ["nonce"] = nonce,
            ["email"] = grant.Email,
            // Apple writes booleans as strings.
            ["email_verified"] = apple ? "true" : true,
        };
        if (apple)
            claims["is_private_email"] = grant.Email.EndsWith(
                "@privaterelay.appleid.com",
                StringComparison.Ordinal
            )
                ? "true"
                : "false";
        foreach (var (name, value) in grant.Claims)
            claims[name] = value;
        var payload = JsonSerializer.Serialize(
            claims.Where(claim => claim.Value is not null).ToDictionary()
        );
        var key = new RsaSecurityKey(grant.WrongSigningKey ? wrongKey : signingKey)
        {
            KeyId = KeyId,
        };
        return new JsonWebTokenHandler().CreateToken(
            payload,
            new SigningCredentials(key, SecurityAlgorithms.RsaSha256)
        );
    }

    private async Task UserInfoAsync(HttpContext context)
    {
        var header = context.Request.Headers.Authorization.ToString();
        if (
            !header.StartsWith("Bearer ", StringComparison.Ordinal)
            || !accessTokens.TryGetValue(header["Bearer ".Length..], out var grant)
        )
        {
            context.Response.StatusCode = 401;
            return;
        }
        var claims = new Dictionary<string, object?>
        {
            ["sub"] = grant.UserInfoSubject ?? grant.Subject,
            ["email"] = grant.Email,
            ["email_verified"] = grant.UserInfoEmailVerified,
        };
        foreach (var (name, value) in grant.UserInfoClaims)
            claims[name] = value;
        await context.Response.WriteAsJsonAsync(claims, context.RequestAborted);
    }

    private static X509Certificate2 CreateCertificate()
    {
        using var key = RSA.Create(2048);
        var request = new CertificateRequest(
            "CN=issuer.example.test",
            key,
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1
        );
        var names = new SubjectAlternativeNameBuilder();
        names.AddDnsName("issuer.example.test");
        request.CertificateExtensions.Add(names.Build());
        var now = DateTimeOffset.UtcNow;
        using var created = request.CreateSelfSigned(now.AddDays(-1), now.AddDays(1));
        // Round-trip through PKCS#12 so the private key is usable by the TLS server.
        return X509CertificateLoader.LoadPkcs12(created.Export(X509ContentType.Pkcs12), null);
    }
}
