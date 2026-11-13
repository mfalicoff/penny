namespace Penny.Backend.Application.Abstractions.Receipts;

// An extraction that failed: `Failure` is a fixed code (ReceiptTextFailure), never
// receipt content or engine output, so it can be stored and logged.
public sealed class ReceiptExtractionException : Exception
{
    public ReceiptExtractionException()
        : this("engine-error") { }

    public ReceiptExtractionException(string failure)
        : base("Receipt text extraction failed: " + failure) => Failure = failure;

    public ReceiptExtractionException(string failure, Exception innerException)
        : base("Receipt text extraction failed: " + failure, innerException) => Failure = failure;

    public string Failure { get; }
}
