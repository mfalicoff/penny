namespace Penny.Backend.Persistence.Receipts;

// `receipts-sweep` output: files old enough to consider, and those removed (or, in a
// dry run, that would be removed), plus receipts nothing links to that were deleted
// past the unlinked retention (MAZ-165), rows and files.
public sealed record ReceiptSweepReport(long Examined, long Removed, bool DryRun, long Unlinked);
