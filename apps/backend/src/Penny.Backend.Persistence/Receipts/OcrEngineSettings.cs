namespace Penny.Backend.Persistence.Receipts;

// Where the local OCR programs are and which languages they read (MAZ-125).
// `Tesseract` is the tesseract program (a path or a name on PATH); `Poppler` the
// directory holding poppler's pdftotext and pdftoppm (null: PATH); `Tessdata` the
// language data directory (null: tesseract's own default). Languages are tesseract
// codes (`eng`, `fra`, ...). Pages without embedded text are rendered at `Dpi`.
public sealed record OcrEngineSettings(
    string Tesseract,
    string? Poppler,
    IReadOnlyList<string> Languages,
    string? Tessdata,
    int Dpi = 300
)
{
    public static readonly IReadOnlyList<string> DefaultLanguages = ["eng", "fra"];

    public string PdfToText => Poppler is null ? "pdftotext" : Path.Combine(Poppler, "pdftotext");

    public string PdfToPpm => Poppler is null ? "pdftoppm" : Path.Combine(Poppler, "pdftoppm");
}
