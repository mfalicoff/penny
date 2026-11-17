using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class ReceiptInboxItemMapping : IEntityTypeConfiguration<ReceiptInboxItem>
{
    public void Configure(EntityTypeBuilder<ReceiptInboxItem> builder)
    {
        builder.ToTable("receipt_inbox_items", table =>
        {
            table.HasCheckConstraint(
                "ck_receipt_inbox_items_status",
                Checks.In("status", "('to_attach','partly_attached','attached','discarded')")
            );
            table.HasCheckConstraint(
                "ck_receipt_inbox_items_attached",
                "(status = 'attached') = (attached_at IS NOT NULL)"
            );
            table.HasCheckConstraint(
                "ck_receipt_inbox_items_encryption_version",
                "encryption_version = 1"
            );
            table.HasCheckConstraint("ck_receipt_inbox_items_key_salt", "length(key_salt) = 32");
            table.HasCheckConstraint(
                "ck_receipt_inbox_items_nonces",
                "length(subject_nonce) = 12 AND length(from_nonce) = 12"
            );
        });
        builder.HasKey(item => item.Id);
        builder.Property(item => item.EncryptionVersion).HasDefaultValue((short)1);
        // Target of owner-enforcing composite foreign keys from inbox receipts.
        builder.HasAlternateKey(item => new { item.UserId, item.Id });
        builder.HasIndex(item => item.InboundMessageId).IsUnique();
        builder.HasIndex(item => new
        {
            item.UserId,
            item.Status,
            item.ReceivedAt,
        });
        builder
            .HasIndex(item => item.ExpiresAt)
            .HasFilter("status IN ('to_attach','partly_attached')")
            .HasDatabaseName("ix_receipt_inbox_items_expiry");
        builder.HasOne<User>().WithMany().HasForeignKey(item => item.UserId);
        builder.HasOne<InboundMessage>().WithMany().HasForeignKey(item => item.InboundMessageId);
    }
}
