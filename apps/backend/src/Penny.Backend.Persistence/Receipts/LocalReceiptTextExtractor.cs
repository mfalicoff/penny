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
//
// Any input is processed with bounded memory and CPU, however large its pixel
// dimensions (a 400-byte PDF can declare a 100-inch page, a 1 MB PNG 30000×30000
// pixels): nothing is ever decoded or rendered at full size.
//
// - Photos: vipsheader reads the dimensions from the file header, then vipsthumbnail
//   decodes with shrink-on-load straight to an 8-bit gray image at most `MaxWidth`
//   wide (aspect kept, never enlarged).
// - Scanned PDF pages: pdfinfo reads each page's size and pdftoppm renders it at
//   `min(Dpi, MaxWidth / page width)` dots per inch, so the bitmap is at most
//   `MaxWidth` wide.
// - Tall results (long receipts) are OCRed in horizontal strips of at most
//   `StripHeight` rows that overlap by `StripOverlap` rows, one at a time, and joined
//   in order (lines repeated by the overlap are dropped), so Tesseract's memory does
//   not grow with the receipt's length. PDF strips are rendered one by one (pdftoppm
//   crop), never as a whole page.
// - At most `MaxPixels` pixels per image or page are read: a taller one is read from
//   the top down to that ceiling and the result is marked truncated (stored as the
//   `truncated` code on a done row).
//
// Every program also runs under the per-process memory and CPU limits of
// `OcrEngineSettings.Limits` (prlimit), the backstop for anything this planning misses.
public sealed partial class LocalReceiptTextExtractor(OcrEngineSettings settings)
    : IReceiptTextExtractor
{
    // A page with fewer letters and digits than this is treated as a scan and OCRed (a
    // scanner app's one-line watermark does not count as embedded text).
    public const int MinTextPageLetters = 40;

    public const string TextMethod = "text";
    public const string OcrMethod = "ocr";
    public const string MixedMethod = "mixed";

    // Widest image handed to Tesseract (a receipt 8.3 inches wide at 300 dpi).
    public const int MaxWidth = 2500;

    // Tallest strip handed to Tesseract at once, and the rows two strips share so a
    // line cut by one strip's edge is whole in the next.
    public const int StripHeight = 4000;
    public const int StripOverlap = 120;

    // Pixels read per image or page after scaling (2500 × 16000, or 1000 × 40000).
    public const long MaxPixels = 40_000_000;

    private const int MaxTextBytes = 16 * 1024 * 1024;
    private const int MaxInfoBytes = 1024 * 1024;

    // A gray image of MaxPixels and its PNM header, or a strip PNG of at most
    // MaxWidth × StripHeight gray pixels (pdftoppm writes them uncompressed at worst).
    private const int MaxImageBytes = (int)(MaxPixels * 2) + 4096;
    private const int MaxDuplicateLines = 8;
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
        {
            var photo = await ImageAsync(content, cancellationToken);
            return new(photo.Text, OcrMethod, 1, photo.Truncated);
        }
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
        string[] pages;
        try
        {
            pages = Encoding.UTF8.GetString(text).Split('\f');
        }
        finally
        {
            CryptographicOperations.ZeroMemory(text);
        }
        // pdftotext ends every page with a form feed.
        var count = Math.Max(1, pages.Length - 1);
        var builder = new StringBuilder();
        var scanned = 0;
        var truncated = false;
        IReadOnlyDictionary<int, PageSize>? sizes = null;
        for (var page = 0; page < count && page < maxPages; page++)
        {
            var pageText = page < pages.Length ? pages[page] : "";
            if (pageText.Count(char.IsLetterOrDigit) < MinTextPageLetters)
            {
                sizes ??= await PageSizesAsync(content, maxPages, cancellationToken);
                var scan = await ScannedPageAsync(
                    content,
                    page + 1,
                    sizes.GetValueOrDefault(page + 1),
                    cancellationToken
                );
                pageText = scan.Text;
                truncated |= scan.Truncated;
                scanned++;
            }
            builder.Append(pageText).Append('\n');
        }
        var read = Math.Min(count, maxPages);
        var method =
            scanned == 0 ? TextMethod
            : scanned == read ? OcrMethod
            : MixedMethod;
        return new(builder.ToString(), method, read, truncated);
    }

    // The scaled size of an image or page: at most MaxWidth wide (never enlarged), its
    // height following the aspect ratio but cut at MaxPixels.
    public static (int Width, int Height, bool Truncated) Plan(double width, double height)
    {
        var scaledWidth = (int)Math.Clamp(Math.Floor(Math.Min(width, MaxWidth)), 1, MaxWidth);
        var scaledHeight = Math.Max(1, Math.Ceiling(height * scaledWidth / width));
        var maxHeight = MaxPixels / scaledWidth;
        return scaledHeight > maxHeight
            ? (scaledWidth, (int)maxHeight, true)
            : (scaledWidth, (int)scaledHeight, false);
    }

    // Top row and height of each strip of an image `height` rows tall.
    public static IEnumerable<(int Top, int Height)> Strips(int height)
    {
        for (var top = 0; ; top += StripHeight - StripOverlap)
        {
            var rows = Math.Min(StripHeight, height - top);
            yield return (top, rows);
            if (top + rows >= height)
                yield break;
        }
    }

    // Strip texts in order; the first lines of a strip that repeat the last lines of the
    // previous one (read twice in the overlap) are dropped.
    public static string JoinStrips(IReadOnlyList<string> texts)
    {
        var lines = new List<string>();
        foreach (var text in texts)
        {
            var next = text.TrimEnd().Split('\n').Select(line => line.TrimEnd()).ToList();
            var first = next.FindIndex(line => line.Length > 0);
            if (first < 0)
                continue;
            var previous = lines
                .Where(line => line.Length > 0)
                .TakeLast(MaxDuplicateLines)
                .ToList();
            var current = next.Skip(first).Where(line => line.Length > 0).ToList();
            var repeated = 0;
            for (var size = Math.Min(previous.Count, current.Count); size > 0; size--)
                if (
                    previous
                        .Skip(previous.Count - size)
                        .SequenceEqual(current.Take(size), StringComparer.Ordinal)
                )
                {
                    repeated = size;
                    break;
                }
            var dropped = 0;
            foreach (var line in next.Skip(first))
            {
                if (dropped < repeated && line.Length > 0)
                {
                    dropped++;
                    continue;
                }
                if (dropped < repeated)
                    continue;
                lines.Add(line);
            }
        }
        return string.Join('\n', lines);
    }

    private async Task<(string Text, bool Truncated)> ImageAsync(
        ReadOnlyMemory<byte> content,
        CancellationToken cancellationToken
    )
    {
        // The header only: dimensions without decoding a single pixel.
        var header = await RunAsync(
            settings.VipsHeader,
            ["stdin"],
            content,
            MaxInfoBytes,
            cancellationToken
        );
        var size = ImageSize().Match(Encoding.UTF8.GetString(header));
        CryptographicOperations.ZeroMemory(header);
        if (
            !size.Success
            || !long.TryParse(size.Groups[1].ValueSpan, CultureInfo.InvariantCulture, out var width)
            || !long.TryParse(
                size.Groups[2].ValueSpan,
                CultureInfo.InvariantCulture,
                out var height
            )
            || width <= 0
            || height <= 0
        )
            throw new ReceiptExtractionException(ReceiptTextFailure.Corrupt);
        var plan = Plan(width, height);
        // Shrink-on-load to the planned box, in 8-bit gray (PGM). Too tall: fill the box
        // at the planned width and keep its top (`low`).
        List<string> arguments =
        [
            "stdin",
            "--size",
            string.Create(CultureInfo.InvariantCulture, $"{plan.Width}x{plan.Height}"),
            "--no-rotate",
            "-o",
            ".pgm",
        ];
        if (plan.Truncated)
            arguments.AddRange(["--smartcrop", "low"]);
        var gray = await RunAsync(
            settings.VipsThumbnail,
            arguments,
            content,
            MaxImageBytes,
            cancellationToken
        );
        try
        {
            var image = GrayImage.Parse(gray);
            if (image.Height <= StripHeight)
                return (await OcrAsync(gray, cancellationToken), plan.Truncated);
            var texts = new List<string>();
            foreach (var (top, rows) in Strips(image.Height))
            {
                var strip = image.Slice(gray, top, rows);
                try
                {
                    texts.Add(await OcrAsync(strip, cancellationToken));
                }
                finally
                {
                    CryptographicOperations.ZeroMemory(strip);
                }
            }
            return (JoinStrips(texts), plan.Truncated);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(gray);
        }
    }

    // Page sizes in points as displayed (crop box, rotation applied).
    private async Task<IReadOnlyDictionary<int, PageSize>> PageSizesAsync(
        ReadOnlyMemory<byte> content,
        int maxPages,
        CancellationToken cancellationToken
    )
    {
        var info = await RunAsync(
            settings.PdfInfo,
            ["-f", "1", "-l", maxPages.ToString(CultureInfo.InvariantCulture), "-"],
            content,
            MaxInfoBytes,
            cancellationToken
        );
        var text = Encoding.UTF8.GetString(info);
        CryptographicOperations.ZeroMemory(info);
        var rotations = PageRotation()
            .Matches(text)
            .ToDictionary(
                match => int.Parse(match.Groups[1].ValueSpan, CultureInfo.InvariantCulture),
                match => int.Parse(match.Groups[2].ValueSpan, CultureInfo.InvariantCulture)
            );
        var sizes = new Dictionary<int, PageSize>();
        foreach (Match match in PageDimensions().Matches(text))
        {
            var page = int.Parse(match.Groups[1].ValueSpan, CultureInfo.InvariantCulture);
            if (
                !double.TryParse(
                    match.Groups[2].ValueSpan,
                    CultureInfo.InvariantCulture,
                    out var width
                )
                || !double.TryParse(
                    match.Groups[3].ValueSpan,
                    CultureInfo.InvariantCulture,
                    out var height
                )
                || width <= 0
                || height <= 0
            )
                continue;
            sizes[page] =
                rotations.GetValueOrDefault(page) % 180 == 90
                    ? new(height, width)
                    : new(width, height);
        }
        return sizes;
    }

    private async Task<(string Text, bool Truncated)> ScannedPageAsync(
        ReadOnlyMemory<byte> content,
        int page,
        PageSize? size,
        CancellationToken cancellationToken
    )
    {
        var number = page.ToString(CultureInfo.InvariantCulture);
        List<string> common =
        [
            "-cropbox",
            "-gray",
            "-png",
            "-f",
            number,
            "-l",
            number,
            "-singlefile",
        ];
        if (size is null)
            // Size unknown: the longer side at MaxWidth bounds the bitmap all the same.
            return (
                await RenderAndOcrAsync(
                    content,
                    [.. common, "-scale-to", MaxWidth.ToString(CultureInfo.InvariantCulture)],
                    cancellationToken
                ),
                false
            );
        // Rounded down to a thousandth so the rendered width stays within MaxWidth.
        var dpi = Math.Floor(Math.Min(settings.Dpi, MaxWidth * 72.0 / size.Width) * 1000) / 1000;
        var plan = Plan(size.Width * dpi / 72, size.Height * dpi / 72);
        List<string> render =
        [
            .. common,
            "-r",
            dpi.ToString("0.###", CultureInfo.InvariantCulture),
        ];
        if (plan.Height <= StripHeight)
            return (
                await RenderAndOcrAsync(
                    content,
                    [.. render, .. Crop(0, plan.Width, plan.Height)],
                    cancellationToken
                ),
                plan.Truncated
            );
        var texts = new List<string>();
        foreach (var (top, rows) in Strips(plan.Height))
            texts.Add(
                await RenderAndOcrAsync(
                    content,
                    [.. render, .. Crop(top, plan.Width, rows)],
                    cancellationToken
                )
            );
        return (JoinStrips(texts), plan.Truncated);
    }

    private static string[] Crop(int top, int width, int height) =>
        [
            "-x",
            "0",
            "-y",
            top.ToString(CultureInfo.InvariantCulture),
            "-W",
            width.ToString(CultureInfo.InvariantCulture),
            "-H",
            height.ToString(CultureInfo.InvariantCulture),
        ];

    private async Task<string> RenderAndOcrAsync(
        ReadOnlyMemory<byte> content,
        IReadOnlyList<string> arguments,
        CancellationToken cancellationToken
    )
    {
        var image = await RunAsync(
            settings.PdfToPpm,
            [.. arguments, "-"],
            content,
            MaxImageBytes,
            cancellationToken
        );
        try
        {
            if (image.Length > 0 && !image.AsSpan().StartsWith(PngSignature))
                throw new ReceiptExtractionException(ReceiptTextFailure.Corrupt);
            return image.Length == 0 ? "" : await OcrAsync(image, cancellationToken);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(image);
        }
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
        try
        {
            return Encoding.UTF8.GetString(output);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(output);
        }
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
                settings.Limits,
                maxOutputBytes,
                cancellationToken
            );
        }
        catch (InvalidOperationException error)
        {
            throw new ReceiptExtractionException(ReceiptTextFailure.EngineError, error);
        }
        // Out of memory under the address-space limit: the engines report it on standard
        // error (pdftoppm then exits 0 with no image), which is only matched here, never
        // stored or logged.
        var outOfMemory = OutOfMemory().IsMatch(result.Error);
        if (result.ExitCode != 0 || (outOfMemory && result.Output.Length == 0))
        {
            CryptographicOperations.ZeroMemory(result.Output);
            throw new ReceiptExtractionException(
                result.HitLimit || outOfMemory ? ReceiptTextFailure.ResourceLimit
                : NotStarted(result) ? ReceiptTextFailure.EngineError
                : ReceiptTextFailure.Corrupt
            );
        }
        return result.Output;
    }

    // prlimit exits 126 or 127 when it cannot execute the program.
    private bool NotStarted(EngineProcess.Result result) =>
        settings.Limits is not null && result.ExitCode is 126 or 127;

    // One OCR thread per page (Tesseract otherwise uses every core per image) and one
    // libvips worker thread; the configured concurrency bounds the total. libvips only
    // loads its trusted decoders (no ImageMagick or other fuzzing-exposed loaders).
    private static Dictionary<string, string> Environment(OcrEngineSettings settings)
    {
        var environment = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["OMP_THREAD_LIMIT"] = "1",
            ["VIPS_CONCURRENCY"] = "1",
            ["VIPS_BLOCK_UNTRUSTED"] = "1",
        };
        if (settings.Tessdata is { } tessdata)
            environment["TESSDATA_PREFIX"] = tessdata;
        return environment;
    }

    // Checks the programs (through the resource limiter, when configured) and the
    // language data and names the engine. Fails clearly when a program is missing or a
    // configured language has no data.
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
                        settings.Limits,
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
            // prlimit exits 126 or 127 when it cannot execute the program.
            if (settings.Limits is not null && result.ExitCode is 126 or 127)
                throw new InvalidOperationException(
                    $"The OCR program {Path.GetFileName(program)} could not be started. Install it or set its path (see docs/operations.md#receipt-text-ocr)."
                );
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
        Run(settings.PdfInfo, "-v");
        Run(settings.PdfToPpm, "-v");
        var vips = VipsVersion().Match(Run(settings.VipsThumbnail, "--version"));
        if (!vips.Success)
            throw new InvalidOperationException(
                "The vipsthumbnail program did not report a version."
            );
        Run(settings.VipsHeader, "--version");
        return string.Create(
            CultureInfo.InvariantCulture,
            $"tesseract {tesseract.Groups[1].Value} ({string.Join('+', settings.Languages)}); poppler {poppler.Groups[1].Value}; vips {vips.Groups[1].Value}"
        );
    }

    private sealed record PageSize(double Width, double Height);

    // An 8-bit or 16-bit binary PGM (P5) from vipsthumbnail: its header and rows.
    private sealed record GrayImage(int Width, int Height, int MaxValue, int DataOffset)
    {
        private int RowBytes => Width * (MaxValue > 255 ? 2 : 1);

        public static GrayImage Parse(byte[] pgm)
        {
            var position = 0;
            string Token()
            {
                while (position < pgm.Length)
                {
                    if (pgm[position] == '#')
                        while (position < pgm.Length && pgm[position] != '\n')
                            position++;
                    else if (pgm[position] is (byte)' ' or (byte)'\t' or (byte)'\r' or (byte)'\n')
                        position++;
                    else
                        break;
                }
                var start = position;
                while (
                    position < pgm.Length
                    && pgm[position] is not ((byte)' ' or (byte)'\t' or (byte)'\r' or (byte)'\n')
                    && position - start < 16
                )
                    position++;
                return Encoding.ASCII.GetString(pgm, start, position - start);
            }
            int Number() =>
                int.TryParse(
                    Token(),
                    NumberStyles.None,
                    CultureInfo.InvariantCulture,
                    out var value
                )
                && value > 0
                    ? value
                    : throw new ReceiptExtractionException(ReceiptTextFailure.Corrupt);
            if (Token() != "P5")
                throw new ReceiptExtractionException(ReceiptTextFailure.Corrupt);
            var width = Number();
            var height = Number();
            var maxValue = Number();
            // Exactly one whitespace byte separates the header from the rows.
            var image = new GrayImage(width, height, maxValue, position + 1);
            if (maxValue > 65535 || (long)image.RowBytes * height > pgm.Length - image.DataOffset)
                throw new ReceiptExtractionException(ReceiptTextFailure.Corrupt);
            return image;
        }

        // A PGM of rows [top, top + rows).
        public byte[] Slice(byte[] pgm, int top, int rows)
        {
            var header = Encoding.ASCII.GetBytes(
                string.Create(CultureInfo.InvariantCulture, $"P5\n{Width} {rows}\n{MaxValue}\n")
            );
            var strip = new byte[header.Length + (RowBytes * rows)];
            header.CopyTo(strip, 0);
            pgm.AsSpan(DataOffset + (RowBytes * top), RowBytes * rows)
                .CopyTo(strip.AsSpan(header.Length));
            return strip;
        }
    }

    [GeneratedRegex(@"tesseract\s+v?([0-9][0-9A-Za-z.\-]*)", RegexOptions.CultureInvariant)]
    private static partial Regex TesseractVersion();

    [GeneratedRegex(@"pdftotext version\s+([0-9][0-9A-Za-z.\-]*)", RegexOptions.CultureInvariant)]
    private static partial Regex PopplerVersion();

    [GeneratedRegex(@"vips-([0-9][0-9A-Za-z.\-]*)", RegexOptions.CultureInvariant)]
    private static partial Regex VipsVersion();

    // vipsheader's summary line: `833x4000 uchar, 3 bands, srgb, pngload_source`.
    [GeneratedRegex(
        @"\b([0-9]{1,10})x([0-9]{1,10}) [a-z]+, [0-9]+ bands?",
        RegexOptions.CultureInvariant
    )]
    private static partial Regex ImageSize();

    [GeneratedRegex(
        @"^Page\s+([0-9]{1,6}) size:\s+([0-9]+(?:\.[0-9]+)?) x ([0-9]+(?:\.[0-9]+)?) pts",
        RegexOptions.CultureInvariant | RegexOptions.Multiline
    )]
    private static partial Regex PageDimensions();

    [GeneratedRegex(
        @"^Page\s+([0-9]{1,6}) rot:\s+([0-9]{1,3})",
        RegexOptions.CultureInvariant | RegexOptions.Multiline
    )]
    private static partial Regex PageRotation();

    // poppler and libpng ("Out of memory"), Leptonica under Tesseract ("pixdata_malloc
    // fail"), C++ (`std::bad_alloc`) and libc ("Cannot allocate memory").
    [GeneratedRegex(
        "out of memory|malloc fail|bad_alloc|cannot allocate memory",
        RegexOptions.CultureInvariant | RegexOptions.IgnoreCase
    )]
    private static partial Regex OutOfMemory();

    [GeneratedRegex("^[A-Za-z0-9_]+$", RegexOptions.CultureInvariant)]
    private static partial Regex LanguagePattern();
}
