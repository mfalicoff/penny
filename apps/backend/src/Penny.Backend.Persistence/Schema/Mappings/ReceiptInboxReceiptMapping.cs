using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class ReceiptInboxReceiptMapping : IEntityTypeConfiguration<ReceiptInboxReceipt>
{
    public void Configure(EntityTypeBuilder<ReceiptInboxReceipt> builder)
    {
        builder.ToTable("receipt_inbox_receipts", table =>
        {
            table.HasCheckConstraint(
                "ck_receipt_inbox_receipts_kind",
                Checks.In("kind", "('email','attachment')")
            );
            table.HasCheckConstraint("ck_receipt_inbox_receipts_position", "position >= 0");
        });
        builder.HasKey(link => new { link.InboxItemId, link.ReceiptId });
        // A receipt belongs to at most one inbox item, and both belong to the same owner.
        builder.HasIndex(link => link.ReceiptId).IsUnique();
        builder.HasIndex(link => new { link.InboxItemId, link.Position }).IsUnique();
        builder
            .HasOne<ReceiptInboxItem>()
            .WithMany()
            .HasForeignKey(link => new { link.UserId, link.InboxItemId })
            .HasPrincipalKey(item => new { item.UserId, item.Id })
            .OnDelete(DeleteBehavior.Cascade);
        builder
            .HasOne<Receipt>()
            .WithMany()
            .HasForeignKey(link => new { link.UserId, link.ReceiptId })
            .HasPrincipalKey(receipt => new { receipt.UserId, receipt.Id });
    }
}
