using System.Text;
using System.Text.RegularExpressions;

namespace Penny.Backend.Api.ClientTelemetry;

// MAZ-129: the server's copy of the web app's privacy rules (apps/web/src/telemetry/scrub.ts),
// applied again to everything a client sends, so a modified or outdated client cannot leak
// what the rules forbid: credentials, codes, emails, search text, ledger contents, amounts.
//
// * URLs keep their origin and the shape of their path only. A segment survives when it is
//   a lowercase word (`households`, `password-reset`), an API version (`v1`) or a built
//   asset's file name; anything else (an id) becomes `:id`. Query strings and fragments are
//   dropped.
// * Free text (error and log messages) keeps its wording, with emails, quoted text and
//   numbers redacted and URLs scrubbed as above.
// * Masked text (session replay) replaces every visible character with `*`.
public static partial class TelemetryScrubber
{
    private const int MaxSegmentLength = 32;

    [GeneratedRegex("^[a-z]+(?:[-_][a-z]+)*$", RegexOptions.CultureInvariant)]
    private static partial Regex Word();

    [GeneratedRegex("^[a-f]{8,}$", RegexOptions.CultureInvariant)]
    private static partial Regex Hex();

    [GeneratedRegex(@"^v\d{1,2}$", RegexOptions.CultureInvariant)]
    private static partial Regex ApiVersion();

    [GeneratedRegex(
        @"^[\w.-]+\.(?:js|mjs|css|map|woff2?|ttf|svg|png|json)$",
        RegexOptions.CultureInvariant
    )]
    private static partial Regex Asset();

    [GeneratedRegex(@"\bhttps?://[^\s""'<>`]+", RegexOptions.CultureInvariant)]
    private static partial Regex UrlInText();

    [GeneratedRegex(
        @"([?#&])(code|token|state)=[^\s&#""'<>`]+",
        RegexOptions.CultureInvariant | RegexOptions.IgnoreCase
    )]
    private static partial Regex CodeInText();

    [GeneratedRegex(@"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", RegexOptions.CultureInvariant)]
    private static partial Regex Email();

    [GeneratedRegex(@"""[^""]*""|'[^']*'|`[^`]*`|“[^”]*”", RegexOptions.CultureInvariant)]
    private static partial Regex Quoted();

    [GeneratedRegex(@"(?<![\w:/.-])[-+]?\d[\d,.]*(?!\w)", RegexOptions.CultureInvariant)]
    private static partial Regex Number();

    [GeneratedRegex("^https?://", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
    private static partial Regex Absolute();

    /// <summary>Scrubs one absolute or root-relative URL; other strings are returned unchanged.</summary>
    public static string ScrubUrl(string value)
    {
        if (value.StartsWith('/') && !value.StartsWith("//", StringComparison.Ordinal))
        {
            var end = value.AsSpan().IndexOfAny('?', '#');
            return ScrubPath(end < 0 ? value : value[..end]);
        }
        if (!Absolute().IsMatch(value))
            return value;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var url))
            return "<url>";
        var origin = url.GetLeftPart(UriPartial.Authority);
        // Credentials never survive, even in the origin.
        if (url.UserInfo.Length > 0)
            origin = $"{url.Scheme}://{url.Authority}";
        return origin + ScrubPath(url.AbsolutePath);
    }

    /// <summary>Redacts user content from free text, keeping its wording.</summary>
    public static string ScrubText(string text)
    {
        text = UrlInText().Replace(text, match => ScrubUrl(match.Value));
        text = CodeInText().Replace(text, "$1$2=<code>");
        text = Email().Replace(text, "<email>");
        text = Quoted().Replace(text, "<text>");
        return Number().Replace(text, "<n>");
    }

    /// <summary>Replaces every visible character with `*`, keeping whitespace and length.</summary>
    public static string Mask(string text)
    {
        var builder = new StringBuilder(text.Length);
        foreach (var character in text)
            builder.Append(char.IsWhiteSpace(character) ? character : '*');
        return builder.ToString();
    }

    private static string ScrubPath(string path) =>
        string.Join(
            '/',
            path.Split('/')
                .Select(segment =>
                    segment.Length == 0
                    || (
                        Word().IsMatch(segment)
                        && segment.Length <= MaxSegmentLength
                        && !Hex().IsMatch(segment)
                    )
                    || ApiVersion().IsMatch(segment)
                    || Asset().IsMatch(segment)
                        ? segment
                        : ":id"
                )
        );
}
