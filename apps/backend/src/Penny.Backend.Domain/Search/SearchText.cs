using System.Globalization;
using System.Text;

namespace Penny.Backend.Domain.Search;

// The search normalization shared by the server, iOS and web (docs/migration/search.md,
// "Text normalization"): NFKD, drop nonspacing marks (General Category Mn),
// locale-independent lowercase, final sigma to sigma and sharp s to "ss", then every
// run of Unicode White_Space becomes one space and the ends are trimmed. The shared
// fixtures in contracts/fixtures/search-cases.json pin the result.
public static class SearchText
{
    private const char FinalSigma = (char)0x03C2;
    private const char Sigma = (char)0x03C3;
    private const char SharpS = (char)0x00DF;

    // `value` must be well-formed UTF-16 (LedgerText.IsStorable); callers validate it.
    public static string Normalize(string value)
    {
        var decomposed = value.Normalize(NormalizationForm.FormKD);
        var unmarked = new StringBuilder(decomposed.Length);
        foreach (var rune in decomposed.EnumerateRunes())
            if (Rune.GetUnicodeCategory(rune) != UnicodeCategory.NonSpacingMark)
                unmarked.Append(rune.ToString());
        var lower = unmarked.ToString().ToLowerInvariant();
        var result = new StringBuilder(lower.Length);
        var pendingSpace = false;
        foreach (var character in lower)
        {
            // .NET char.IsWhiteSpace is exactly the Unicode White_Space property.
            if (char.IsWhiteSpace(character))
            {
                pendingSpace = result.Length > 0;
                continue;
            }
            if (pendingSpace)
            {
                result.Append(' ');
                pendingSpace = false;
            }
            if (character == FinalSigma)
                result.Append(Sigma);
            else if (character == SharpS)
                result.Append("ss");
            else
                result.Append(character);
        }
        return result.ToString();
    }

    // Number of Unicode code points (the typo tier needs at least three).
    public static int CodePoints(string value) => value.EnumerateRunes().Count();

    // Whether the text has a letter or decimal digit (the meaning tier needs one).
    public static bool HasLetterOrDigit(string value) =>
        value.EnumerateRunes().Any(Rune.IsLetterOrDigit);

    // Literal LIKE pattern: `%`, `_` and the escape character `\` match themselves.
    public static string ContainsPattern(string normalized)
    {
        var pattern = new StringBuilder(normalized.Length + 2);
        pattern.Append('%');
        foreach (var character in normalized)
        {
            if (character is '%' or '_' or '\\')
                pattern.Append('\\');
            pattern.Append(character);
        }
        pattern.Append('%');
        return pattern.ToString();
    }
}
