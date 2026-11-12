namespace Penny.Backend.Application.Abstractions.Receipts;

// Raw extracted text, how it was obtained (`text`: embedded PDF text only, `ocr`:
// OCR only, `mixed`: a PDF with both) and how many pages were read.
public sealed record ReceiptExtraction(string Text, string Method, int Pages);
