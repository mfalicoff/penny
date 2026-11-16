using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Penny.Backend.Persistence.Receipts;

namespace Penny.Backend.Persistence.InboundMail;

// The OCR engine's sandboxed programs, reused for emailed receipts (MAZ-184): libvips
// re-encodes inline images to PNG (metadata stripped, at most 2000 px on a side) and
// pdfinfo counts the rendered PDF's pages. Bytes go through standard input and output,
// under the same prlimit memory and CPU limits as OCR.
public sealed partial class MailImageTools(OcrEngineSettings settings)
{
    private const int MaxImageBytes = 32 * 1024 * 1024;
    private const int MaxInfoBytes = 64 * 1024;
    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    // The PNG, or null when libvips cannot decode the image.
    public async Task<byte[]?> ReencodePngAsync(
        ReadOnlyMemory<byte> image,
        int maxDimension,
        CancellationToken cancellationToken
    )
    {
        var size = maxDimension.ToString(CultureInfo.InvariantCulture);
        var result = await RunAsync(
            settings.VipsThumbnail,
            ["stdin", "--size", $"{size}x{size}>", "-o", ".png[strip]"],
            image,
            MaxImageBytes,
            cancellationToken
        );
        return result is { Length: > 8 } && result.AsSpan().StartsWith(PngSignature)
            ? result
            : null;
    }

    // Null when pdfinfo cannot read the document.
    public async Task<int?> PageCountAsync(
        ReadOnlyMemory<byte> pdf,
        CancellationToken cancellationToken
    )
    {
        var output = await RunAsync(settings.PdfInfo, ["-"], pdf, MaxInfoBytes, cancellationToken);
        if (output is null)
            return null;
        var match = Pages().Match(Encoding.UTF8.GetString(output));
        return
            match.Success
            && int.TryParse(
                match.Groups[1].ValueSpan,
                NumberStyles.None,
                CultureInfo.InvariantCulture,
                out var pages
            )
            ? pages
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

    [GeneratedRegex(
        @"^Pages:\s+(\d{1,6})\s*$",
        RegexOptions.Multiline | RegexOptions.CultureInvariant
    )]
    private static partial Regex Pages();
}
