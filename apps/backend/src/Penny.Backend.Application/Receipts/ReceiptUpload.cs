namespace Penny.Backend.Application.Receipts;

// One upload as the request carried it (MAZ-131). `Name` and `Mime` are null when their
// header is missing or malformed; `Content` is null when the body exceeded
// `ReceiptFormat.MaxBytes`, so the service can report checks in contract order.
public sealed record ReceiptUpload(string? Name, string? Mime, byte[]? Content);
