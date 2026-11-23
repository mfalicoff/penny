using System.Text;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// Synthetic pictures for the profile suites (MAZ-171) and a WebP size reader, so tests
// can check what the server stored without an image library.
public static class ProfileImages
{
    // A marker hidden in a JPEG comment segment: re-encoding must drop it, as it drops
    // EXIF location.
    public const string HiddenMarker = "PENNY-SYNTHETIC-LOCATION-48.8584N";

    // A portrait page (taller than wide) rendered by poppler, with a comment segment.
    public static byte[] JpegWithMetadata()
    {
        var jpeg = SyntheticReceipts.Jpeg("Profile picture");
        var comment = Encoding.ASCII.GetBytes(HiddenMarker);
        var length = comment.Length + 2;
        byte[] segment = [0xFF, 0xFE, (byte)(length >> 8), (byte)length, .. comment];
        // After SOI (FF D8).
        return [.. jpeg[..2], .. segment, .. jpeg[2..]];
    }

    public static byte[] Png() => SyntheticReceipts.Png("Provider picture");

    // Width and height of a WebP (lossy, lossless or extended).
    public static (int Width, int Height) WebpSize(byte[] webp)
    {
        var chunk = Encoding.ASCII.GetString(webp, 12, 4);
        return chunk switch
        {
            "VP8 " => (
                (webp[26] | (webp[27] << 8)) & 0x3FFF,
                (webp[28] | (webp[29] << 8)) & 0x3FFF
            ),
            "VP8L" => (
                1 + (((webp[22] & 0x3F) << 8) | webp[21]),
                1 + (((webp[24] & 0x0F) << 10) | (webp[23] << 2) | ((webp[22] & 0xC0) >> 6))
            ),
            "VP8X" => (
                1 + (webp[24] | (webp[25] << 8) | (webp[26] << 16)),
                1 + (webp[27] | (webp[28] << 8) | (webp[29] << 16))
            ),
            _ => throw new InvalidOperationException("Not a WebP."),
        };
    }
}
