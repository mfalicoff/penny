namespace Penny.Backend.Application.Abstractions.Persistence;

// `receipts-ocr`: rows created for receipts that had none (uploaded before MAZ-125 or
// imported) and rows queued again (failed, made by another engine or language set,
// or every row with `--all`).
public sealed record ReceiptTextQueueReport(long Created, long Requeued);
