using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class PushOutboxMessageMapping : IEntityTypeConfiguration<PushOutboxMessage>
{
    public void Configure(EntityTypeBuilder<PushOutboxMessage> builder)
    {
        builder.ToTable(
            "push_outbox",
            table =>
            {
                table.HasCheckConstraint("ck_push_outbox_attempts", "attempts >= 0");
                table.HasCheckConstraint("ck_push_outbox_lease", Checks.Lease);
            }
        );
        builder.HasKey(message => message.Id);
        builder.Property(message => message.Payload).HasColumnType("jsonb");
        builder.HasOne<User>().WithMany().HasForeignKey(message => message.UserId);
        builder.HasOne<Household>().WithMany().HasForeignKey(message => message.HouseholdId);
        builder
            .HasIndex(message => message.NextAttemptAt)
            .HasFilter("sent_at IS NULL")
            .HasDatabaseName("ix_push_outbox_due");
    }
}
