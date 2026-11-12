namespace Penny.Backend.Persistence.Receipts;

// Where the local OCR programs are and which languages they read (MAZ-125).
// `Tesseract` is the tesseract program (a path or a name on PATH); `Poppler` the
// directory holding poppler's pdftotext, pdfinfo and pdftoppm (null: PATH); `Vips` the
// directory holding libvips' vipsheader and vipsthumbnail (null: PATH); `Tessdata` the
// language data directory (null: tesseract's own default). Languages are tesseract
// codes (`eng`, `fra`, ...). Pages without embedded text are rendered at `Dpi` at most
// (less for wide pages, see LocalReceiptTextExtractor). `Limits` caps each engine
// process's memory and CPU time (null: no per-process limits, e.g. on macOS).
public sealed record OcrEngineSettings(
    string Tesseract,
    string? Poppler,
    IReadOnlyList<string> Languages,
    string? Tessdata,
    int Dpi = 300,
    string? Vips = null,
    OcrEngineLimits? Limits = null
)
{
    public static readonly IReadOnlyList<string> DefaultLanguages = ["eng", "fra"];

    public string PdfToText => Poppler is null ? "pdftotext" : Path.Combine(Poppler, "pdftotext");

    public string PdfInfo => Poppler is null ? "pdfinfo" : Path.Combine(Poppler, "pdfinfo");

    public string PdfToPpm => Poppler is null ? "pdftoppm" : Path.Combine(Poppler, "pdftoppm");

    public string VipsHeader => Vips is null ? "vipsheader" : Path.Combine(Vips, "vipsheader");

    public string VipsThumbnail =>
        Vips is null ? "vipsthumbnail" : Path.Combine(Vips, "vipsthumbnail");
}
