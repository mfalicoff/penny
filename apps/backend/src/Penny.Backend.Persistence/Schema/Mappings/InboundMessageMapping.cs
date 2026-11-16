using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class InboundMessageMapping : IEntityTypeConfiguration<InboundMessage>
{
    private const string AuthResults = "('pass','fail','none','unknown')";

    public void Configure(EntityTypeBuilder<InboundMessage> builder)
    {
        builder.ToTable(
            "inbound_messages",
            table =>
            {
                table.HasCheckConstraint(
                    "ck_inbound_messages_status",
                    Checks.In("status", "('pending','processing','done','rejected','failed')")
                );
                table.HasCheckConstraint("ck_inbound_messages_sha256", "sha256 ~ '^[0-9a-f]{64}$'");
                table.HasCheckConstraint(
                    "ck_inbound_messages_auth",
                    $"(auth_spf IS NULL OR auth_spf IN {AuthResults}) AND (auth_dkim IS NULL OR auth_dkim IN {AuthResults}) AND (auth_dmarc IS NULL OR auth_dmarc IN {AuthResults})"
                );
                table.HasCheckConstraint(
                    "ck_inbound_messages_reason",
                    "reason_code IS NULL OR reason_code ~ '^[a-z_]{1,40}$'"
                );
                table.HasCheckConstraint("ck_inbound_messages_size", "size_bytes >= 0");
                table.HasCheckConstraint("ck_inbound_messages_attempts", "attempts >= 0");
                // Waiting rows are exactly the due ones.
                table.HasCheckConstraint(
                    "ck_inbound_messages_due",
                    "(status IN ('pending','processing')) = (due_at IS NOT NULL)"
                );
                table.HasCheckConstraint(
                    "ck_inbound_messages_lease",
                    "(lease_token IS NULL) = (lease_expires_at IS NULL)"
                );
                table.HasCheckConstraint(
                    "ck_inbound_messages_storage_path",
                    "storage_path IS NULL OR storage_path ~ '^inbound/[0-9a-f]{2}/[0-9a-f]{32}$'"
                );
                table.HasCheckConstraint(
                    "ck_inbound_messages_encryption_version",
                    "encryption_version = 1"
                );
                table.HasCheckConstraint("ck_inbound_messages_key_salt", "length(key_salt) = 32");
                table.HasCheckConstraint(
                    "ck_inbound_messages_file_nonce",
                    "length(file_nonce) = 12"
                );
            }
        );
        builder.HasKey(message => message.Id);
        builder.Property(message => message.EncryptionVersion).HasDefaultValue((short)1);
        // The same message forwarded twice creates one row (and one inbox item).
        builder.HasIndex(message => new { message.UserId, message.Sha256 }).IsUnique();
        builder.HasIndex(message => message.StoragePath).IsUnique();
        builder
            .HasIndex(message => message.DueAt)
            .HasFilter("due_at IS NOT NULL")
            .HasDatabaseName("ix_inbound_messages_due");
        // Per-address rate limits count recent messages.
        builder.HasIndex(message => new { message.AddressId, message.ReceivedAt });
        builder.HasOne<User>().WithMany().HasForeignKey(message => message.UserId);
        builder.HasOne<ReceiptMailAddress>().WithMany().HasForeignKey(message => message.AddressId);
    }
}
