using System.Diagnostics.CodeAnalysis;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Penny.Backend.Application.Authentication;

// Session tokens: 32 random bytes as lowercase hex. Only SHA-256(token text)
// is stored, so database contents cannot be replayed as credentials.
public static partial class SessionTokens
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(30);

    public static string Create() => RandomNumberGenerator.GetHexString(64, lowercase: true);

    public static string NewId() => RandomNumberGenerator.GetHexString(32, lowercase: true);

    public static string Hash(string token) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public static bool IsWellFormed([NotNullWhen(true)] string? token) =>
        token is not null && Format().IsMatch(token);

    [GeneratedRegex("^[a-f0-9]{64}\\z", RegexOptions.CultureInvariant)]
    private static partial Regex Format();
}
