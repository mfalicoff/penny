using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Penny.Backend.Api.Configuration;

namespace Penny.Backend.Api.Authentication;

// Sign in with Apple's client secret (MAZ-170): an ES256 JWT signed with the operator's
// private key, `iss` the team id, `sub` the client (Services) id, `aud` Apple, valid for a
// day (Apple allows up to six months). It is made with IdentityModel and replaced once half
// its lifetime has passed, so a long-running server never sends an expired one.
public sealed class AppleClientSecret : IDisposable
{
    public const string Audience = OidcProviderOptions.AppleIssuer;
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(1);

    private readonly AppleClientSecretOptions options;
    private readonly TimeProvider clock;
    private readonly ECDsa key = ECDsa.Create();
    private readonly JsonWebTokenHandler tokens = new();
    private readonly Lock gate = new();
    private string? current;
    private DateTimeOffset renewAt;

    public AppleClientSecret(AppleClientSecretOptions options, TimeProvider clock)
    {
        this.options = options;
        this.clock = clock;
        key.ImportFromPem(options.PrivateKeyPem);
    }

    public override string ToString() => "Apple client secret (redacted)";

    public string Current()
    {
        lock (gate)
        {
            var now = clock.GetUtcNow();
            if (current is null || now >= renewAt)
            {
                current = Create(now);
                renewAt = now + Lifetime / 2;
            }
            return current;
        }
    }

    private string Create(DateTimeOffset now)
    {
        var issued = now.ToUnixTimeSeconds();
        var payload = JsonSerializer.Serialize(
            new Dictionary<string, object>
            {
                ["iss"] = options.TeamId,
                ["iat"] = issued,
                ["exp"] = issued + (long)Lifetime.TotalSeconds,
                ["aud"] = Audience,
                ["sub"] = options.ClientId,
            }
        );
        return tokens.CreateToken(
            payload,
            new SigningCredentials(
                new ECDsaSecurityKey(key) { KeyId = options.KeyId },
                SecurityAlgorithms.EcdsaSha256
            )
        );
    }

    public void Dispose() => key.Dispose();
}
