using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class ReceiptMailAddressMapping : IEntityTypeConfiguration<ReceiptMailAddress>
{
    public void Configure(EntityTypeBuilder<ReceiptMailAddress> builder)
    {
        builder.ToTable(
            "receipt_mail_addresses",
            table =>
            {
                table.HasCheckConstraint(
                    "ck_receipt_mail_addresses_hash",
                    "local_part_hash ~ '^[0-9a-f]{64}$'"
                );
                table.HasCheckConstraint(
                    "ck_receipt_mail_addresses_encryption_version",
                    "encryption_version = 1"
                );
                table.HasCheckConstraint(
                    "ck_receipt_mail_addresses_key_salt",
                    "length(key_salt) = 32"
                );
                table.HasCheckConstraint(
                    "ck_receipt_mail_addresses_nonces",
                    "length(address_nonce) = 12 AND length(allowed_senders_nonce) = 12"
                );
                table.HasCheckConstraint(
                    "ck_receipt_mail_addresses_expiry",
                    "expires_at > created_at"
                );
            }
        );
        builder.HasKey(address => address.Id);
        builder.Property(address => address.EncryptionVersion).HasDefaultValue((short)1);
        builder.HasIndex(address => address.LocalPartHash).IsUnique();
        // At most one live address per user; expired rows are revoked when replaced.
        builder
            .HasIndex(address => address.UserId)
            .IsUnique()
            .HasFilter("revoked_at IS NULL")
            .HasDatabaseName("ux_receipt_mail_addresses_current");
        builder.HasOne<User>().WithMany().HasForeignKey(address => address.UserId);
    }
}
