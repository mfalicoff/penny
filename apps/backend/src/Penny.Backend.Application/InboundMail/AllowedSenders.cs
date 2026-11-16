using System.Text.RegularExpressions;

namespace Penny.Backend.Application.InboundMail;

// The optional sender allowlist of a receipt address (MAZ-184, sender policy): email
// addresses (`billing@shop.example`) or whole domains (`shop.example`, `@shop.example`
// is accepted and stored without the `@`). Lowercased, de-duplicated, sorted.
public static partial class AllowedSenders
{
    public const int MaxEntries = 50;
    public const string Invalid =
        "Allowed senders must be email addresses or domains, at most 50 of them.";

    public static IReadOnlyList<string>? Normalize(IEnumerable<string?> values)
    {
        var result = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var raw in values)
        {
            if (raw is null)
                return null;
            var value = raw.Trim().ToLowerInvariant();
            if (value.StartsWith('@'))
                value = value[1..];
            if (!IsSender(value))
                return null;
            result.Add(value);
            if (result.Count > MaxEntries)
                return null;
        }
        return [.. result];
    }

    // An allowed sender matches the exact address or any address at the domain.
    public static bool Allows(IReadOnlyCollection<string> allowed, string fromAddress)
    {
        var from = fromAddress.Trim().ToLowerInvariant();
        var at = from.LastIndexOf('@');
        if (at <= 0)
            return false;
        var domain = from[(at + 1)..];
        return allowed.Contains(from) || allowed.Contains(domain);
    }

    private static bool IsSender(string value)
    {
        if (value.Length is 0 or > 254)
            return false;
        var at = value.LastIndexOf('@');
        if (at < 0)
            return Domain().IsMatch(value);
        return LocalPart().IsMatch(value[..at]) && Domain().IsMatch(value[(at + 1)..]);
    }

    [GeneratedRegex(
        "^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$",
        RegexOptions.CultureInvariant
    )]
    private static partial Regex Domain();

    [GeneratedRegex("^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$", RegexOptions.CultureInvariant)]
    private static partial Regex LocalPart();
}
