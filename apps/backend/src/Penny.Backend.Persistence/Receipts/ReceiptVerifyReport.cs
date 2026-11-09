namespace Penny.Backend.Persistence.Receipts;

// `receipts-verify` output. `Unreferenced` files (no row, or unfinished temporary
// writes) are reported but do not make the store inconsistent; `Missing` and
// `Corrupt` rows do.
public sealed record ReceiptVerifyReport(
    long Receipts,
    long Verified,
    long Missing,
    long Corrupt,
    long Unreferenced,
    long Bytes
)
{
    public bool Clean => Missing == 0 && Corrupt == 0;
}
