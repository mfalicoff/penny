using Penny.Backend.Application.Receipts;

namespace Penny.Backend.Application.Profiles;

// Picture uploads (MAZ-171): PNG, JPEG, WebP, HEIC or HEIF up to 10 MiB whose signature
// matches its type. The server decodes, crops to a square, resizes to at most 512 px,
// re-encodes as WebP and strips every metadata block (location included).
public static class AvatarFormat
{
    public const int MaxBytes = ReceiptFormat.MaxBytes;
    public const int MaxSide = 512;
    public const int MinSide = 16;

    // Decoding bound: larger images are refused before a pixel is decoded.
    public const long MaxPixels = 50_000_000;
    public const string StoredMime = "image/webp";

    public static readonly IReadOnlyList<string> Mimes =
    [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/heic",
        "image/heif",
    ];

    public static bool IsAcceptable(string? mime, ReadOnlySpan<byte> content) =>
        mime is not null
        && Mimes.Contains(mime, StringComparer.Ordinal)
        && ReceiptFormat.IsAcceptable(mime, content);
}
