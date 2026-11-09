namespace Penny.Backend.Application.Receipts;

// Legacy server/validation/receipts.ts: the accepted MIME types, the base64 text and
// decoded size limits, Node's lenient base64 decoding and the file-signature check.
public static class ReceiptFormat
{
    public const int MaxNameLength = 255;
    public const int MaxBase64Length = 14 * 1024 * 1024;
    public const int MaxBytes = 10 * 1024 * 1024;

    public static readonly IReadOnlyList<string> Mimes =
    [
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "image/heic",
        "image/heif",
    ];

    // zod `regex(/^[A-Za-z0-9+/]+={0,2}$/)`: at least one alphabet character, then at
    // most two trailing `=`. No whitespace, no URL-safe alphabet.
    public static bool IsBase64Text(string value)
    {
        var end = value.Length;
        var padding = 0;
        while (end > 0 && value[end - 1] == '=' && padding < 2)
        {
            end--;
            padding++;
        }
        if (end == 0)
            return false;
        for (var index = 0; index < end; index++)
        {
            var character = value[index];
            if (
                character
                is not (>= 'A' and <= 'Z')
                    and not (>= 'a' and <= 'z')
                    and not (>= '0' and <= '9')
                    and not '+'
                    and not '/'
            )
                return false;
        }
        return true;
    }

    // Node `Buffer.from(text, "base64")` for text that passed IsBase64Text: padding is
    // optional, a dangling sixth-bit character is ignored and unused low bits are
    // dropped. Convert.FromBase64String would reject the unpadded forms.
    public static byte[] Decode(string base64)
    {
        var body = base64.TrimEnd('=');
        var whole = body.Length - body.Length % 4;
        var tail = body.Length % 4;
        var text = tail switch
        {
            2 => body + "==",
            3 => body + "=",
            _ => body[..whole],
        };
        return text.Length == 0 ? [] : Convert.FromBase64String(text);
    }

    // The decoded size and the file signature for the declared MIME type.
    public static bool IsAcceptable(string mime, ReadOnlySpan<byte> content)
    {
        if (content.Length is 0 or > MaxBytes)
            return false;
        var header = content[..Math.Min(content.Length, 12)];
        return mime switch
        {
            "application/pdf" => header.StartsWith("%PDF-"u8),
            "image/jpeg" => header.StartsWith((ReadOnlySpan<byte>)[0xFF, 0xD8, 0xFF]),
            "image/png" => header.StartsWith(
                (ReadOnlySpan<byte>)[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
            ),
            "image/gif" => header.StartsWith("GIF87a"u8) || header.StartsWith("GIF89a"u8),
            "image/webp" => header.Length == 12
                && header[..4].SequenceEqual("RIFF"u8)
                && header[8..12].SequenceEqual("WEBP"u8),
            // HEIC and HEIF: an ISO base media `ftyp` box at offset 4.
            _ => header.Length >= 8 && header[4..8].SequenceEqual("ftyp"u8),
        };
    }
}
