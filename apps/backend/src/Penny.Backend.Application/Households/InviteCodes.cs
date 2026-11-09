using System.Security.Cryptography;
using System.Text;

namespace Penny.Backend.Application.Households;

// Legacy invite codes: 5 random bytes as 10 upper-case hex characters, valid for 10
// minutes. Only SHA-256 of the upper-case code text is stored (lower-case hex), the
// legacy `hashToken`, so imported invites keep working and stored hashes cannot be
// replayed as codes.
public static class InviteCodes
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);

    public static string Create() => RandomNumberGenerator.GetHexString(10, lowercase: false);

    public static string Hash(string code) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(code)));
}
