using System.Text;

namespace Penny.Backend.Application.Receipts;

// Turns raw engine output into storable text: every run of whitespace inside a line
// becomes one space, lines are trimmed, empty lines (and page breaks) are dropped, and
// control characters and unpaired surrogates (which PostgreSQL text cannot hold) are
// removed. The result is cut to at most `maxLength` UTF-16 units without splitting a
// surrogate pair.
public static class ReceiptTextCleaner
{
    public static string Clean(string raw, int maxLength)
    {
        var lines = new List<string>();
        var line = new StringBuilder();
        var space = false;
        var length = 0;
        void Flush()
        {
            if (line.Length > 0)
            {
                lines.Add(line.ToString());
                length += line.Length + 1;
            }
            line.Clear();
            space = false;
        }
        for (var index = 0; index < raw.Length && length < maxLength; index++)
        {
            var character = raw[index];
            if (
                character
                is '\n'
                    or '\r'
                    or '\f'
                    or '\v'
                    or (char)0x0085
                    or (char)0x2028
                    or (char)0x2029
            )
            {
                Flush();
                continue;
            }
            if (char.IsWhiteSpace(character))
            {
                space = line.Length > 0;
                continue;
            }
            if (char.IsHighSurrogate(character))
            {
                if (index + 1 >= raw.Length || !char.IsLowSurrogate(raw[index + 1]))
                    continue;
                if (space)
                    line.Append(' ');
                space = false;
                line.Append(character).Append(raw[++index]);
                continue;
            }
            if (char.IsLowSurrogate(character) || char.IsControl(character))
                continue;
            if (space)
                line.Append(' ');
            space = false;
            line.Append(character);
        }
        Flush();
        var text = string.Join('\n', lines);
        if (text.Length <= maxLength)
            return text;
        var end = maxLength;
        if (char.IsLowSurrogate(text[end]) && char.IsHighSurrogate(text[end - 1]))
            end--;
        return text[..end].TrimEnd();
    }
}
