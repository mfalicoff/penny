using System.Text;

namespace Penny.Backend.Api.Contracts;

// The download's Content-Disposition, byte for byte:
// `inline; filename*=UTF-8''` + encodeURIComponent(name).
public static class ReceiptDisposition
{
    public static string Inline(string name) =>
        "inline; filename*=UTF-8''" + EncodeUriComponent(name);

    // JavaScript encodeURIComponent over UTF-8: keeps A–Z a–z 0–9 - _ . ! ~ * ' ( )
    // and percent-encodes every other byte with uppercase hex.
    public static string EncodeUriComponent(string value)
    {
        var builder = new StringBuilder(value.Length);
        foreach (var octet in Encoding.UTF8.GetBytes(value))
        {
            if (
                (char)octet
                is (>= 'A' and <= 'Z')
                    or (>= 'a' and <= 'z')
                    or (>= '0' and <= '9')
                    or '-'
                    or '_'
                    or '.'
                    or '!'
                    or '~'
                    or '*'
                    or '\''
                    or '('
                    or ')'
            )
                builder.Append((char)octet);
            else
                builder.Append('%').Append(octet.ToString("X2", null));
        }
        return builder.ToString();
    }
}
