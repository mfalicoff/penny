namespace Penny.Backend.Application.Receipts;

// Receipt format rules: the accepted MIME types, the name and size limits and the
// file-signature check.
public static class ReceiptFormat
{
    public const int MaxNameLength = 255;
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

    // The size and the file signature for the declared MIME type.
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
