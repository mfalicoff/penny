using System.Globalization;

namespace Penny.Backend.Domain.Ledgers;

// String rules shared with the JavaScript clients. Lengths are UTF-16 code units,
// exactly like JavaScript `string.length`.
public static class LedgerText
{
    // JavaScript String.prototype.trim, which differs from string.Trim(): it trims
    // U+FEFF but not U+0085.
    public static string TrimLikeJavaScript(string value)
    {
        var start = 0;
        var end = value.Length;
        while (start < end && IsJavaScriptWhitespace(value[start]))
            start++;
        while (end > start && IsJavaScriptWhitespace(value[end - 1]))
            end--;
        return value[start..end];
    }

    // PostgreSQL text cannot hold NUL or unpaired UTF-16 surrogates, though JSON can.
    // Such strings are rejected instead of failing the save.
    public static bool IsStorable(string value)
    {
        for (var index = 0; index < value.Length; index++)
        {
            var character = value[index];
            if (character == (char)0)
                return false;
            if (char.IsHighSurrogate(character))
            {
                if (index + 1 >= value.Length || !char.IsLowSurrogate(value[index + 1]))
                    return false;
                index++;
            }
            else if (char.IsLowSurrogate(character))
                return false;
        }
        return true;
    }

    private static bool IsJavaScriptWhitespace(char character) =>
        character
            is (char)0x09
                or (char)0x0A
                or (char)0x0B
                or (char)0x0C
                or (char)0x0D
                or (char)0x20
                or (char)0xA0
                or (char)0xFEFF
                or (char)0x2028
                or (char)0x2029
        || char.GetUnicodeCategory(character) == UnicodeCategory.SpaceSeparator;
}
