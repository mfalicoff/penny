using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Penny.Backend.Application.Abstractions.Profiles;
using Penny.Backend.Application.Profiles;
using Penny.Backend.Persistence.Receipts;

namespace Penny.Backend.Persistence.Profiles;

// Profile pictures (MAZ-171) through the OCR engine's sandboxed libvips programs, under the
// same prlimit memory and CPU limits: vipsheader reads the dimensions from the header
// (no pixel is decoded), then vipsthumbnail applies the EXIF orientation, crops the centre
// square, shrinks it to at most 512 px (never enlarges) and writes WebP with `strip`, so
// no metadata (location, camera, ICC comments) survives. Bytes travel through standard
// input and output only.
public sealed partial class AvatarImageProcessor(OcrEngineSettings settings) : IAvatarImageProcessor
{
    private const int MaxInfoBytes = 64 * 1024;
    private const int MaxOutputBytes = 1024 * 1024;

    public async Task<byte[]?> ProcessAsync(
        ReadOnlyMemory<byte> image,
        CancellationToken cancellationToken
    )
    {
        var header = await RunAsync(
            settings.VipsHeader,
            ["stdin"],
            image,
            MaxInfoBytes,
            cancellationToken
        );
        if (header is null)
            return null;
        var size = ImageSize().Match(Encoding.UTF8.GetString(header));
        if (
            !size.Success
            || !long.TryParse(size.Groups[1].ValueSpan, CultureInfo.InvariantCulture, out var width)
            || !long.TryParse(
                size.Groups[2].ValueSpan,
                CultureInfo.InvariantCulture,
                out var height
            )
            || Math.Min(width, height) < AvatarFormat.MinSide
            || width * height > AvatarFormat.MaxPixels
        )
            return null;
        var side = Math.Min(AvatarFormat.MaxSide, Math.Min(width, height))
            .ToString(CultureInfo.InvariantCulture);
        var output = await RunAsync(
            settings.VipsThumbnail,
            [
                "stdin",
                "--size",
                $"{side}x{side}",
                "--smartcrop",
                "centre",
                "-o",
                ".webp[Q=82,strip]",
            ],
            image,
            MaxOutputBytes,
            cancellationToken
        );
        return
            output is { Length: > 12 }
            && output.AsSpan(0, 4).SequenceEqual("RIFF"u8)
            && output.AsSpan(8, 4).SequenceEqual("WEBP"u8)
            ? output
            : null;
    }

    private async Task<byte[]?> RunAsync(
        string program,
        IReadOnlyList<string> arguments,
        ReadOnlyMemory<byte> input,
        int maxOutputBytes,
        CancellationToken cancellationToken
    )
    {
        EngineProcess.Result result;
        try
        {
            result = await EngineProcess.RunAsync(
                program,
                arguments,
                input,
                new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["VIPS_CONCURRENCY"] = "1",
                    ["VIPS_BLOCK_UNTRUSTED"] = "1",
                },
                settings.Limits,
                maxOutputBytes,
                cancellationToken
            );
        }
        catch (InvalidOperationException)
        {
            return null;
        }
        return result.ExitCode == 0 ? result.Output : null;
    }

    // vipsheader: "stdin: 4032x3024 uchar, 3 bands, srgb, jpegload_source".
    [GeneratedRegex(@"\b(\d{1,9})x(\d{1,9})\b", RegexOptions.CultureInvariant)]
    private static partial Regex ImageSize();
}
