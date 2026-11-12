using System.Text.RegularExpressions;
using Penny.Backend.Application.Receipts;
using Penny.Backend.Persistence.Receipts;

namespace Penny.Backend.Api.Configuration;

// Receipt text extraction settings (MAZ-125, docs/operations.md#receipt-text-ocr).
// `Ocr__Worker=false` stops this process from extracting (another process may; leases
// keep them apart). When the worker runs, the engine and every language in
// `Ocr__Languages` (default `eng+fra`) are checked at startup and the host fails before
// listening if one is missing. `Ocr__Tesseract`, `Ocr__PopplerDirectory` and
// `Ocr__TessdataDirectory` locate the programs and language data (default: PATH and
// tesseract's own data directory).
public sealed partial record OcrOptions(
    bool Worker,
    int PollSeconds,
    OcrEngineSettings Engine,
    ReceiptTextSettings Limits
)
{
    public static OcrOptions Read(IConfiguration configuration)
    {
        var worker = configuration["Ocr:Worker"] switch
        {
            null => true,
            "true" => true,
            "false" => false,
            _ => throw new InvalidOperationException("Ocr:Worker must be true or false."),
        };
        var languages = (configuration["Ocr:Languages"] ?? "eng+fra")
            .Split(
                ['+', ','],
                StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries
            )
            .Distinct(StringComparer.Ordinal)
            .ToList();
        if (languages.Count == 0 || languages.Any(language => !Language().IsMatch(language)))
            throw new InvalidOperationException(
                "Ocr:Languages must be Tesseract language codes joined by + (for example eng+fra)."
            );
        var engine = new OcrEngineSettings(
            Program(configuration["Ocr:Tesseract"]) ?? "tesseract",
            Directory(configuration["Ocr:PopplerDirectory"], "Ocr:PopplerDirectory"),
            languages,
            Directory(configuration["Ocr:TessdataDirectory"], "Ocr:TessdataDirectory")
        );
        var limits = new ReceiptTextSettings(
            BackendOptions.ReadBounded(configuration, "Ocr:MaxFileMegabytes", 10, 1, 10)
                * 1024L
                * 1024L,
            BackendOptions.ReadBounded(configuration, "Ocr:MaxPages", 10, 1, 100),
            TimeSpan.FromSeconds(
                BackendOptions.ReadBounded(configuration, "Ocr:TimeoutSeconds", 120, 1, 3600)
            ),
            BackendOptions.ReadBounded(configuration, "Ocr:Concurrency", 1, 1, 8),
            BackendOptions.ReadBounded(configuration, "Ocr:MaxAttempts", 4, 1, 20)
        );
        return new(
            worker,
            BackendOptions.ReadBounded(configuration, "Ocr:PollSeconds", 5, 1, 3600),
            engine,
            limits
        );
    }

    private static string? Program(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value;

    private static string? Directory(string? value, string key)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;
        if (!Path.IsPathFullyQualified(value))
            throw new InvalidOperationException($"{key} must be an absolute directory.");
        return value;
    }

    [GeneratedRegex("^[A-Za-z0-9_]{2,32}$", RegexOptions.CultureInvariant)]
    private static partial Regex Language();
}
