using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class PushDeliveryMapping : IEntityTypeConfiguration<PushDelivery>
{
    public void Configure(EntityTypeBuilder<PushDelivery> builder)
    {
        builder.ToTable(
            "push_deliveries",
            table =>
            {
                table.HasCheckConstraint("ck_push_deliveries_attempts", "attempts >= 0");
                table.HasCheckConstraint("ck_push_deliveries_lease", Checks.Lease);
                table.HasCheckConstraint(
                    "ck_push_deliveries_provider",
                    "provider IN ('expo','apns')"
                );
            }
        );
        builder.HasKey(delivery => new { delivery.OutboxId, delivery.Token });
        builder.Property(delivery => delivery.Provider).HasDefaultValue("expo");
        builder.HasOne<PushOutboxMessage>().WithMany().HasForeignKey(delivery => delivery.OutboxId);
        builder
            .HasIndex(delivery => delivery.NextAttemptAt)
            .HasFilter("sent_at IS NULL")
            .HasDatabaseName("ix_push_deliveries_due");
        builder
            .HasIndex(delivery => delivery.SentAt)
            .HasFilter("ticket_id IS NOT NULL AND receipt_checked_at IS NULL")
            .HasDatabaseName("ix_push_deliveries_receipts");
        // Device removal and invalid-token cleanup finish a token's pending deliveries.
        builder
            .HasIndex(delivery => delivery.Token)
            .HasFilter("sent_at IS NULL")
            .HasDatabaseName("ix_push_deliveries_pending_token");
    }
}
