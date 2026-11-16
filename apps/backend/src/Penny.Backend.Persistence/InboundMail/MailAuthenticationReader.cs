using System.Globalization;
using System.Text.RegularExpressions;
using MimeKit;
using Penny.Backend.Application.Abstractions.InboundMail;

namespace Penny.Backend.Persistence.InboundMail;

// Reads SPF, DKIM and DMARC results added by Penny's own ingress (MAZ-184). A sender can
// put any header in a message, so only one header is trusted: the
// ARC-Authentication-Results with the highest instance (`i=`) whose authserv-id is the
// configured ingress (Cloudflare Email Routing: `mx.cloudflare.net`). An ARC sealer
// always numbers its set above every set already in the message, so a forged set
// can't outrank the ingress' own. Without that header every result is `unknown`.
// Which header Email Routing adds must be confirmed in a staging zone (doc task 4).
public static partial class MailAuthenticationReader
{
    public const string DefaultAuthServId = "mx.cloudflare.net";

    public static MailAuthentication Read(HeaderList headers, string authServId)
    {
        string? best = null;
        var bestInstance = -1;
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
                match.Success
                && int.TryParse(
                    match.Groups[1].ValueSpan,
                    NumberStyles.None,
                    CultureInfo.InvariantCulture,
                    out var instance
                )
                && instance > bestInstance
            )
            {
                bestInstance = instance;
                best = header.Value[match.Length..];
            }
        }
        return best is null ? MailAuthentication.Missing : Parse(best, authServId);
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
