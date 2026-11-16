namespace Penny.Backend.Persistence.Schema.Entities;

// The receipts of one inbox item, in display order: the rendered email (`email`) and
// each imported attachment (`attachment`). MAZ-184.
public sealed class ReceiptInboxReceipt
{
    public required string InboxItemId { get; set; }
    public required string ReceiptId { get; set; }
    public required string UserId { get; set; }
    public required string Kind { get; set; }
    public int Position { get; set; }
}
