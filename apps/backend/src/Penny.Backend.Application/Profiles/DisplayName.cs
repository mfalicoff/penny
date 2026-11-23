using System.Globalization;
using System.Text;

namespace Penny.Backend.Application.Profiles;

// Display names (MAZ-171): display text only, never identity. A name is trimmed (the
// JavaScript whitespace set, as for emails), has 1 to 60 UTF-16 code units, as in
// JavaScript, and no control characters (Unicode Cc) or line and paragraph separators.
public static class DisplayName
{
    public const int MaxLength = 60;

    // A name a person typed: the trimmed name, or null when it breaks a rule. Callers
    // decide what an empty name means before calling.
    public static string? Normalize(string? name)
    {
        if (name is null)
            return null;
        var trimmed = name.Trim(Whitespace);
        return trimmed.Length is >= 1 and <= MaxLength && !trimmed.Any(IsControl) ? trimmed : null;
    }

    // True when the trimmed name is empty: a sign-up form that left the field blank.
    public static bool IsBlank(string? name) => name is null || name.Trim(Whitespace).Length == 0;

    // A provider's name (`name`, else `given_name` and `family_name`): control
    // characters become spaces, runs of whitespace collapse, and a long name is cut at
    // 60 code units without splitting a surrogate pair. Null when nothing is left, so the
    // provider is treated as not sending a name.
    public static string? FromProvider(string? name, string? givenName, string? familyName)
    {
        var source = string.IsNullOrWhiteSpace(name)
            ? string.Join(
                ' ',
                new[] { givenName, familyName }.Where(part => !string.IsNullOrWhiteSpace(part))
            )
            : name;
        var builder = new StringBuilder(source.Length);
        var space = false;
        foreach (var character in source)
        {
            if (IsControl(character) || Whitespace.Contains(character))
            {
                space = builder.Length > 0;
                continue;
            }
            if (space)
                builder.Append(' ');
            space = false;
            builder.Append(character);
        }
        if (builder.Length > MaxLength)
        {
            var cut = MaxLength;
            if (char.IsHighSurrogate(builder[cut - 1]))
                cut--;
            builder.Length = cut;
        }
        var result = builder.ToString().Trim(Whitespace);
        return result.Length == 0 ? null : result;
    }

    private static bool IsControl(char character) =>
        char.GetUnicodeCategory(character)
            is UnicodeCategory.Control
                or UnicodeCategory.LineSeparator
                or UnicodeCategory.ParagraphSeparator;

    // JavaScript String.prototype.trim: WhiteSpace plus LineTerminator code points.
    private static readonly char[] Whitespace =
    [
        (char)0x0009,
        (char)0x000A,
        (char)0x000B,
        (char)0x000C,
        (char)0x000D,
        (char)0x0020,
        (char)0x00A0,
        (char)0x1680,
        (char)0x2000,
        (char)0x2001,
        (char)0x2002,
        (char)0x2003,
        (char)0x2004,
        (char)0x2005,
        (char)0x2006,
        (char)0x2007,
        (char)0x2008,
        (char)0x2009,
        (char)0x200A,
        (char)0x2028,
        (char)0x2029,
        (char)0x202F,
        (char)0x205F,
        (char)0x3000,
        (char)0xFEFF,
    ];
}
