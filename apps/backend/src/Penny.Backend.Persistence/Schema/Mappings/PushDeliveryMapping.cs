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
            table => table.HasCheckConstraint("ck_push_deliveries_attempts", "attempts >= 0")
        );
        builder.HasKey(delivery => new { delivery.OutboxId, delivery.Token });
        builder.HasOne<PushOutboxMessage>().WithMany().HasForeignKey(delivery => delivery.OutboxId);
        builder
            .HasIndex(delivery => delivery.NextAttemptAt)
            .HasFilter("sent_at IS NULL")
            .HasDatabaseName("ix_push_deliveries_due");
        // Device removal and invalid-token cleanup finish a token's pending deliveries.
        builder
            .HasIndex(delivery => delivery.Token)
            .HasFilter("sent_at IS NULL")
            .HasDatabaseName("ix_push_deliveries_pending_token");
    }
}
