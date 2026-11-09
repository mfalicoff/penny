using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Penny.Backend.Api.Push;

// The APNs provider authentication token: an ES256 JWT {alg, kid} / {iss, iat}
// signed with the .p8 key. Apple rejects tokens older than an hour and refreshes
// more often than every 20 minutes (TooManyProviderTokenUpdates), so one token is
// reused for 40 minutes and replaced early only when APNs reports it expired and it
// is at least 20 minutes old.
public sealed class ApnsProviderToken(ApnsCredentials credentials, TimeProvider clock)
{
    public static readonly TimeSpan Reuse = TimeSpan.FromMinutes(40);
    public static readonly TimeSpan MinimumAge = TimeSpan.FromMinutes(20);

    private readonly Lock gate = new();
    private (string Value, DateTimeOffset IssuedAt)? current;

    public string Current()
    {
        lock (gate)
        {
            var now = clock.GetUtcNow();
            if (current is not { } token || now - token.IssuedAt >= Reuse || now < token.IssuedAt)
                current = token = (Mint(now), now);
            return token.Value;
        }
    }

    // APNs answered ExpiredProviderToken for `rejected`.
    public void Expire(string rejected)
    {
        lock (gate)
        {
            if (
                current is { } token
                && string.Equals(token.Value, rejected, StringComparison.Ordinal)
                && clock.GetUtcNow() - token.IssuedAt >= MinimumAge
            )
                current = null;
        }
    }

    private string Mint(DateTimeOffset now)
    {
        var header = Encode(
            JsonSerializer.SerializeToUtf8Bytes(new { alg = "ES256", kid = credentials.KeyId })
        );
        var claims = Encode(
            JsonSerializer.SerializeToUtf8Bytes(
                new { iss = credentials.TeamId, iat = now.ToUnixTimeSeconds() }
            )
        );
        var signed = $"{header}.{claims}";
        var signature = credentials.Key.SignData(
            Encoding.ASCII.GetBytes(signed),
            HashAlgorithmName.SHA256,
            DSASignatureFormat.IeeeP1363FixedFieldConcatenation
        );
        return $"{signed}.{Encode(signature)}";
    }

    private static string Encode(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
