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
    private const string KeyId = "synthetic-key";

    private readonly RSA signingKey = RSA.Create(2048);
    private readonly RSA wrongKey = RSA.Create(2048);
    private readonly ConcurrentDictionary<
        string,
        (FakeOidcGrant Grant, string Nonce, string Challenge, string RedirectUri)
    > codes = new();
    private readonly ConcurrentDictionary<string, FakeOidcGrant> accessTokens = new();
    private X509Certificate2 certificate = null!;
    private WebApplication provider = null!;
    private int port;
    private int tokenRequests;

    public int TokenRequests => Volatile.Read(ref tokenRequests);
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
    }

    public void Reset()
    {
        codes.Clear();
        accessTokens.Clear();
        Interlocked.Exchange(ref tokenRequests, 0);
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

    public TestApiFactory CreateApi(
        string connectionString,
        IReadOnlyDictionary<string, string>? settings = null,
        Action<IServiceCollection>? configure = null
    ) =>
        new(
            connectionString,
            settings ?? Settings(),
            services =>
            {
                services
                    .AddHttpClient(OidcProviderClient.HttpClientName)
                    .ConfigurePrimaryHttpMessageHandler(CreateHandler);
                configure?.Invoke(services);
            }
        );

    // Plays the user approving sign-in at the provider and returns the redirect the
    // app receives. Asserts the request is a code flow with S256 PKCE.
    public string Authorize(string authorizationUrl, FakeOidcGrant? grant = null)
    {
        if (!authorizationUrl.StartsWith(Issuer + "/authorize?", StringComparison.Ordinal))
            throw new InvalidOperationException("Unexpected authorization endpoint.");
        var query = QueryHelpers.ParseQuery(new Uri(authorizationUrl).Query);
        if (
            query["response_type"] != "code"
            || query["client_id"] != ClientId
            || query["scope"] != OidcProviderClient.Scope
            || query["code_challenge_method"] != "S256"
        )
            throw new InvalidOperationException("Unexpected authorization request.");
        var code = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
        var redirectUri = query["redirect_uri"].ToString();
        codes[code] = (
            grant ?? new FakeOidcGrant(),
            query["nonce"].ToString(),
            query["code_challenge"].ToString(),
            redirectUri
        );
        var callback =
            $"{redirectUri}?code={code}&state={Uri.EscapeDataString(query["state"].ToString())}";
        return SendsIssuer ? callback + "&iss=" + Uri.EscapeDataString(Issuer) : callback;
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
        switch (context.Request.Path.Value)
        {
            case "/.well-known/openid-configuration" when Available:
                await context.Response.WriteAsJsonAsync(
                    new Dictionary<string, object>
                    {
                        ["issuer"] = DiscoveryIssuer,
                        ["authorization_endpoint"] = Issuer + "/authorize",
                        ["token_endpoint"] = Issuer + "/token",
                        ["userinfo_endpoint"] = Issuer + "/userinfo",
                        ["jwks_uri"] = Issuer + "/jwks",
                        ["response_types_supported"] = new[] { "code" },
                        ["subject_types_supported"] = new[] { "public" },
                        ["id_token_signing_alg_values_supported"] = new[] { "RS256" },
                        ["code_challenge_methods_supported"] = new[] { "S256" },
                        ["authorization_response_iss_parameter_supported"] = SendsIssuer,
                    },
                    ct
                );
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
            || form["client_id"] != ClientId
            || form["client_secret"] != ClientSecret
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
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var claims = new Dictionary<string, object?>
        {
            ["iss"] = Issuer,
            ["sub"] = issued.Grant.Subject,
            ["aud"] = ClientId,
            ["iat"] = now,
            ["exp"] = now + 300,
            ["nonce"] = issued.Nonce,
            ["email"] = issued.Grant.Email,
            ["email_verified"] = true,
        };
        foreach (var (name, value) in issued.Grant.Claims)
            claims[name] = value;
        var payload = JsonSerializer.Serialize(
            claims.Where(claim => claim.Value is not null).ToDictionary()
        );
        var key = new RsaSecurityKey(issued.Grant.WrongSigningKey ? wrongKey : signingKey)
        {
            KeyId = KeyId,
        };
        var idToken = new JsonWebTokenHandler().CreateToken(
            payload,
            new SigningCredentials(key, SecurityAlgorithms.RsaSha256)
        );
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
        await context.Response.WriteAsJsonAsync(
            new Dictionary<string, object?>
            {
                ["sub"] = grant.UserInfoSubject ?? grant.Subject,
                ["email"] = grant.Email,
                ["email_verified"] = grant.UserInfoEmailVerified,
            },
            context.RequestAborted
        );
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
