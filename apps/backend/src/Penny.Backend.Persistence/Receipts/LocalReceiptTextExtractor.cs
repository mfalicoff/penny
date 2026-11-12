using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Penny.Backend.Application.Abstractions.Receipts;
using Penny.Backend.Application.Receipts;

namespace Penny.Backend.Persistence.Receipts;

// Receipt text on this server only (MAZ-125): poppler's pdftotext reads a PDF's
// embedded text directly; pages without enough embedded text (scans) are rendered by
// pdftoppm and, like photos, read by Tesseract. Each program runs as a child process
// fed through standard input and read from standard output (EngineProcess), so
// plaintext never touches the disk, the time bound can kill it and a crash in an image
// or PDF parser cannot take the API down. HEIC/HEIF are not readable by Tesseract's
// image library and are reported unsupported.
public sealed partial class LocalReceiptTextExtractor(OcrEngineSettings settings)
    : IReceiptTextExtractor
{
    // A page with fewer letters and digits than this is treated as a scan and OCRed (a
    // scanner app's one-line watermark does not count as embedded text).
    public const int MinTextPageLetters = 40;

    public const string TextMethod = "text";
    public const string OcrMethod = "ocr";
    public const string MixedMethod = "mixed";

    private const int MaxTextBytes = 16 * 1024 * 1024;
    private const int MaxImageBytes = 128 * 1024 * 1024;
    private static readonly TimeSpan ProbeTimeout = TimeSpan.FromSeconds(15);
    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    private readonly Lazy<string> engine = new(
        () => Probe(settings),
        LazyThreadSafetyMode.PublicationOnly
    );

    public string Engine => engine.Value;

    public bool Supports(string mime) =>
        mime is "application/pdf" or "image/jpeg" or "image/png" or "image/gif" or "image/webp";

    public async Task<ReceiptExtraction> ExtractAsync(
        string mime,
        ReadOnlyMemory<byte> content,
        int maxPages,
        CancellationToken cancellationToken
    )
    {
        if (!Supports(mime))
            throw new ReceiptExtractionException(ReceiptTextFailure.UnsupportedFormat);
        // Tesseract reads an unrecognized input as a list of file names, so only bytes
        // with a recognized image signature are ever handed to it.
        if (!ReceiptFormat.IsAcceptable(mime, content.Span))
            throw new ReceiptExtractionException(ReceiptTextFailure.Corrupt);
        if (mime != "application/pdf")
            return new(await OcrAsync(content, cancellationToken), OcrMethod, 1);
        var text = await RunAsync(
            settings.PdfToText,
            [
                "-layout",
                "-enc",
                "UTF-8",
                "-l",
                maxPages.ToString(CultureInfo.InvariantCulture),
                "-",
                "-",
            ],
            content,
            MaxTextBytes,
            cancellationToken
        );
        var pages = Encoding.UTF8.GetString(text).Split('\f');
        // pdftotext ends every page with a form feed.
        var count = Math.Max(1, pages.Length - 1);
        var builder = new StringBuilder();
        var scanned = 0;
        for (var page = 0; page < count && page < maxPages; page++)
        {
            var pageText = page < pages.Length ? pages[page] : "";
            if (pageText.Count(char.IsLetterOrDigit) < MinTextPageLetters)
            {
                var image = await RunAsync(
                    settings.PdfToPpm,
                    [
                        "-r",
                        settings.Dpi.ToString(CultureInfo.InvariantCulture),
                        "-gray",
                        "-png",
                        "-f",
                        (page + 1).ToString(CultureInfo.InvariantCulture),
                        "-l",
                        (page + 1).ToString(CultureInfo.InvariantCulture),
                        "-singlefile",
                        "-",
                    ],
                    content,
                    MaxImageBytes,
                    cancellationToken
                );
                try
                {
                    if (image.Length > 0 && !image.AsSpan().StartsWith(PngSignature))
                        throw new ReceiptExtractionException(ReceiptTextFailure.Corrupt);
                    pageText = image.Length == 0 ? "" : await OcrAsync(image, cancellationToken);
                }
                finally
                {
                    CryptographicOperations.ZeroMemory(image);
                }
                scanned++;
            }
            builder.Append(pageText).Append('\n');
        }
        var read = Math.Min(count, maxPages);
        var method =
            scanned == 0 ? TextMethod
            : scanned == read ? OcrMethod
            : MixedMethod;
        return new(builder.ToString(), method, read);
    }

    private async Task<string> OcrAsync(
        ReadOnlyMemory<byte> image,
        CancellationToken cancellationToken
    )
    {
        var output = await RunAsync(
            settings.Tesseract,
            ["stdin", "stdout", "-l", string.Join('+', settings.Languages)],
            image,
            MaxTextBytes,
            cancellationToken
        );
        return Encoding.UTF8.GetString(output);
    }

    private async Task<byte[]> RunAsync(
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
                Environment(settings),
                maxOutputBytes,
                cancellationToken
            );
        }
        catch (InvalidOperationException error)
        {
            throw new ReceiptExtractionException(ReceiptTextFailure.EngineError, error);
        }
        if (result.ExitCode != 0)
        {
            CryptographicOperations.ZeroMemory(result.Output);
            throw new ReceiptExtractionException(ReceiptTextFailure.Corrupt);
        }
        return result.Output;
    }

    // One OCR thread per page (Tesseract otherwise uses every core per image); the
    // configured concurrency bounds the total.
    private static Dictionary<string, string> Environment(OcrEngineSettings settings)
    {
        var environment = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["OMP_THREAD_LIMIT"] = "1",
        };
        if (settings.Tessdata is { } tessdata)
            environment["TESSDATA_PREFIX"] = tessdata;
        return environment;
    }

    // Checks the programs and language data and names the engine. Fails clearly when a
    // program is missing or a configured language has no data.
    private static string Probe(OcrEngineSettings settings)
    {
        string Run(string program, params string[] arguments)
        {
            using var timeout = new CancellationTokenSource(ProbeTimeout);
            EngineProcess.Result result;
            try
            {
                result = EngineProcess
                    .RunAsync(
                        program,
                        arguments,
                        ReadOnlyMemory<byte>.Empty,
                        Environment(settings),
                        1024 * 1024,
                        timeout.Token
                    )
                    .GetAwaiter()
                    .GetResult();
            }
            catch (OperationCanceledException)
            {
                throw new InvalidOperationException(
                    $"The OCR program {Path.GetFileName(program)} did not answer `{string.Join(' ', arguments)}` in time."
                );
            }
            if (result.ExitCode != 0)
                throw new InvalidOperationException(
                    $"The OCR program {Path.GetFileName(program)} failed `{string.Join(' ', arguments)}` (exit code {result.ExitCode}). Check the installation (see docs/operations.md#receipt-text-ocr)."
                );
            return Encoding.UTF8.GetString(result.Output) + "\n" + result.Error;
        }
        var tesseract = TesseractVersion().Match(Run(settings.Tesseract, "--version"));
        if (!tesseract.Success)
            throw new InvalidOperationException("The tesseract program did not report a version.");
        var available = Run(settings.Tesseract, "--list-langs")
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(line => LanguagePattern().IsMatch(line))
            .ToHashSet(StringComparer.Ordinal);
        var missing = settings.Languages.Where(language => !available.Contains(language)).ToList();
        if (missing.Count > 0)
            throw new InvalidOperationException(
                $"OCR language data is missing for {string.Join(", ", missing)} (Ocr__Languages is {string.Join('+', settings.Languages)}). Install the Tesseract language data (Debian/Ubuntu: tesseract-ocr-{missing[0]}; Nix: tesseract.override {{ enableLanguages = [ ... ]; }}) or set Ocr__TessdataDirectory. See docs/operations.md#receipt-text-ocr."
            );
        var poppler = PopplerVersion().Match(Run(settings.PdfToText, "-v"));
        if (!poppler.Success)
            throw new InvalidOperationException("The pdftotext program did not report a version.");
        Run(settings.PdfToPpm, "-v");
        return string.Create(
            CultureInfo.InvariantCulture,
            $"tesseract {tesseract.Groups[1].Value} ({string.Join('+', settings.Languages)}); poppler {poppler.Groups[1].Value}"
        );
    }

    [GeneratedRegex(@"tesseract\s+v?([0-9][0-9A-Za-z.\-]*)", RegexOptions.CultureInvariant)]
    private static partial Regex TesseractVersion();

    [GeneratedRegex(@"pdftotext version\s+([0-9][0-9A-Za-z.\-]*)", RegexOptions.CultureInvariant)]
    private static partial Regex PopplerVersion();

    [GeneratedRegex("^[A-Za-z0-9_]+$", RegexOptions.CultureInvariant)]
    private static partial Regex LanguagePattern();
}
