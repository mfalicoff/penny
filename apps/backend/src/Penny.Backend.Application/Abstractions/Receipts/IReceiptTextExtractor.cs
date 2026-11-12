namespace Penny.Backend.Application.Abstractions.Receipts;

// A local text extraction engine for receipts (MAZ-125). Receipts never leave the
// server: PDFs with embedded text are read directly, images and scanned pages go
// through local OCR.
public interface IReceiptTextExtractor
{
    // The engines, their versions and the OCR languages; stored with every result so
    // `receipts-ocr` can re-run receipts after an engine or language change. Reading it
    // checks the engine: a missing program or language fails with
    // InvalidOperationException.
    string Engine { get; }

    // Whether this MIME type can be read at all (otherwise the receipt is unsupported).
    bool Supports(string mime);

    // The text of at most `maxPages` pages. Cancellation stops the engine at once.
    // Throws ReceiptExtractionException for a corrupt or unreadable file.
    Task<ReceiptExtraction> ExtractAsync(
        string mime,
        ReadOnlyMemory<byte> content,
        int maxPages,
        CancellationToken cancellationToken
    );
}
