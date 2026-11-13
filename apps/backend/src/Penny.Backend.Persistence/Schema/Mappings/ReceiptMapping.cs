using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class ReceiptMapping : IEntityTypeConfiguration<Receipt>
{
    public void Configure(EntityTypeBuilder<Receipt> builder)
    {
        builder.ToTable(
            "receipts",
            table =>
            {
                table.HasCheckConstraint(
                    "ck_receipts_storage_path",
                    "storage_path ~ '^[0-9a-f]{2}/[0-9a-f]{32}$'"
                );
                // ReceiptFileStore.Versions: the sealing schemes this build can open.
                table.HasCheckConstraint(
                    "ck_receipts_encryption_version",
                    "encryption_version = 1"
                );
                table.HasCheckConstraint("ck_receipts_key_salt", "length(key_salt) = 32");
                table.HasCheckConstraint("ck_receipts_file_nonce", "length(file_nonce) = 12");
                table.HasCheckConstraint("ck_receipts_name_nonce", "length(name_nonce) = 12");
                table.HasCheckConstraint("ck_receipts_mime", Checks.Length("mime", 1, 100));
                table.HasCheckConstraint("ck_receipts_size", "size_bytes >= 0");
            }
        );
        builder.HasKey(receipt => receipt.Id);
        // Rows written before the column existed used scheme 1, the only one so far.
        builder.Property(receipt => receipt.EncryptionVersion).HasDefaultValue((short)1);
        // Target of owner-enforcing composite foreign keys from personal entries.
        builder.HasAlternateKey(receipt => new { receipt.UserId, receipt.Id });
        builder.HasIndex(receipt => receipt.StoragePath).IsUnique();
        builder.HasOne<User>().WithMany().HasForeignKey(receipt => receipt.UserId);
    }
}
