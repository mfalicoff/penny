using Penny.Backend.Application.Abstractions.Persistence;

namespace Penny.Backend.Application.Receipts;

// Unlinked receipt cleanup (MAZ-165): a receipt is uploaded as soon as it is picked and
// linked only on Save, so discarded drafts, replaced or removed receipts and cancelled
// forms leave receipts nothing links to. Once older than the retention they are
// deleted, rows and files; anything still linked is never touched.
public sealed class ReceiptCleanupService(
    IReceiptRepository receipts,
    TimeProvider clock,
    TimeSpan retention
)
{
    public Task<long> RunOnceAsync(CancellationToken cancellationToken) =>
        receipts.DeleteUnlinkedAsync(clock.GetUtcNow() - retention, cancellationToken);
}
