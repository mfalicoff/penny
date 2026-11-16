using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Penny.Backend.Application.InboundMail;

// Receipt address local parts (MAZ-184): `r-` and 20 characters of lowercase base32,
// about 100 bits of randomness. Only SHA-256 of the local part is stored and searched,
// like session and invite tokens. Plus-addressing maps to the same address.
public static partial class ReceiptMailAddresses
{
    public const string Prefix = "r-";
    public const int TokenLength = 20;
    private const string Alphabet = "abcdefghijklmnopqrstuvwxyz234567";

    public static string NewLocalPart() =>
        Prefix + new string(RandomNumberGenerator.GetItems<char>(Alphabet, TokenLength));

    // The canonical local part of a recipient (`R-ABC…+tag@Domain` or a bare local
    // part), or null when it cannot be a receipt address.
    public static string? Normalize(string? recipient)
    {
        if (string.IsNullOrEmpty(recipient) || recipient.Length > 320)
            return null;
        var local = recipient.Split('@')[0].ToLowerInvariant();
        var plus = local.IndexOf('+', StringComparison.Ordinal);
        if (plus >= 0)
            local = local[..plus];
        return IsLocalPart(local) ? local : null;
    }

    public static bool IsLocalPart(string? value) =>
        value is not null && LocalPartPattern().IsMatch(value);

    public static string Hash(string localPart) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.ASCII.GetBytes(localPart)));

    [GeneratedRegex("^r-[a-z2-7]{20}$", RegexOptions.CultureInvariant)]
    private static partial Regex LocalPartPattern();
}
