using System.Globalization;
using System.Text.RegularExpressions;
using MimeKit;
using Penny.Backend.Application.Abstractions.InboundMail;

namespace Penny.Backend.Persistence.InboundMail;

// Reads SPF, DKIM and DMARC results added by Penny's own ingress (MAZ-184). A sender can
// put any header in a message, so only one header is trusted: the topmost
// ARC-Authentication-Results (the ingress prepends its headers), and only when it is
// also the highest valid instance, every instance is unique and in range, and its
// authserv-id is the configured ingress (Cloudflare Email Routing: mx.cloudflare.net).
// Anything else is "unknown", so a forged chain can only lose verification, never gain
// it. If the ingress adds no ARC set at all, the topmost set would be the sender's:
// confirm in a staging zone that Email Routing seals every message (doc task 4).
public static partial class MailAuthenticationReader
{
    public const string DefaultAuthServId = "mx.cloudflare.net";

    // RFC 8617: an ARC instance is 1 to 50.
    public const int MaxInstance = 50;

    // The ingress prepends its headers, so its set is the topmost ARC-Authentication-Results.
    // That set is trusted only when it also has the highest instance, the instances are
    // valid (1 to 50) and unique, and its authserv-id is the ingress. A sender can add sets
    // below it, but a forged set numbered above it (or out of range, or a duplicate)
    // makes the whole chain untrusted rather than verified.
    public static MailAuthentication Read(HeaderList headers, string authServId)
    {
        var sets = new List<(int Instance, string Value)>();
        foreach (var header in headers)
        {
            if (
                !header.Field.Equals(
                    "ARC-Authentication-Results",
                    StringComparison.OrdinalIgnoreCase
                )
            )
                continue;
            var match = Instance().Match(header.Value);
            if (
                !match.Success
                || !int.TryParse(
                    match.Groups[1].ValueSpan,
                    NumberStyles.None,
                    CultureInfo.InvariantCulture,
                    out var instance
                )
                || instance is < 1 or > MaxInstance
            )
                return MailAuthentication.Missing;
            sets.Add((instance, header.Value[match.Length..]));
        }
        if (sets.Count == 0)
            return MailAuthentication.Missing;
        var topmost = sets[0];
        if (
            sets.Select(set => set.Instance).Distinct().Count() != sets.Count
            || sets.Any(set => set.Instance > topmost.Instance)
        )
            return MailAuthentication.Missing;
        return Parse(topmost.Value, authServId);
    }

    // `<authserv-id> [version]; method=result ...; method=result ...` (RFC 8601).
    public static MailAuthentication Parse(string value, string authServId)
    {
        var text = Comments().Replace(value, " ");
        var parts = text.Split(';', StringSplitOptions.TrimEntries);
        if (parts.Length == 0)
            return MailAuthentication.Missing;
        var id = parts[0].Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
        if (!string.Equals(id, authServId, StringComparison.OrdinalIgnoreCase))
            return MailAuthentication.Missing;
        var results = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in parts.Skip(1))
        {
            var match = Method().Match(part);
            if (match.Success)
                results.TryAdd(match.Groups[1].Value, Result(match.Groups[2].Value));
        }
        return new(
            results.GetValueOrDefault("spf", MailAuthentication.Unknown),
            results.GetValueOrDefault("dkim", MailAuthentication.Unknown),
            results.GetValueOrDefault("dmarc", MailAuthentication.Unknown)
        );
    }

    private static string Result(string value) =>
        value.ToLowerInvariant() switch
        {
            "pass" => MailAuthentication.Pass,
            "none" => MailAuthentication.None,
            "fail" or "softfail" or "neutral" or "policy" or "permerror" or "temperror" =>
                MailAuthentication.Fail,
            _ => MailAuthentication.Unknown,
        };

    [GeneratedRegex(@"^\s*i\s*=\s*(\d{1,4})\s*;", RegexOptions.CultureInvariant)]
    private static partial Regex Instance();

    [GeneratedRegex(@"\([^()]*\)", RegexOptions.CultureInvariant)]
    private static partial Regex Comments();

    [GeneratedRegex(@"^(spf|dkim|dmarc)\s*=\s*([a-zA-Z]+)", RegexOptions.CultureInvariant)]
    private static partial Regex Method();
}
