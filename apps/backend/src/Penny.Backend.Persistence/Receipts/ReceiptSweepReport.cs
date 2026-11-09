namespace Penny.Backend.Persistence.Receipts;

// `receipts-sweep` output: files old enough to consider, and those removed (or, in a
// dry run, that would be removed).
public sealed record ReceiptSweepReport(long Examined, long Removed, bool DryRun);
