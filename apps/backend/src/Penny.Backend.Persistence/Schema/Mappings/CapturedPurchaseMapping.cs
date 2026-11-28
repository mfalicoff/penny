using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class CapturedPurchaseMapping : IEntityTypeConfiguration<CapturedPurchase>
{
    public void Configure(EntityTypeBuilder<CapturedPurchase> builder)
    {
        builder.ToTable("captured_purchases", table =>
        {
            table.HasCheckConstraint(
                "ck_captured_purchases_status",
                Checks.In("status", "('to_review','done')")
            );
            table.HasCheckConstraint(
                "ck_captured_purchases_outcome",
                "(status = 'to_review' AND outcome IS NULL AND resolved_at IS NULL "
                    + "AND entry_id IS NULL AND household_id IS NULL) OR "
                    + "(status = 'done' AND resolved_at IS NOT NULL AND ("
                    + "(outcome IN ('added','attached') AND entry_id IS NOT NULL) OR "
                    + "(outcome = 'discarded' AND entry_id IS NULL AND household_id IS NULL)))"
            );
            table.HasCheckConstraint("ck_captured_purchases_amount", Checks.Cents("amount", 1));
            table.HasCheckConstraint("ck_captured_purchases_currency", "currency ~ '^[A-Z]{3}$'");
            table.HasCheckConstraint(
                "ck_captured_purchases_idempotency_key",
                Checks.Length("idempotency_key", 1, 64)
            );
            table.HasCheckConstraint(
                "ck_captured_purchases_merchant",
                Checks.Length("merchant", 1, 100)
            );
            table.HasCheckConstraint(
                "ck_captured_purchases_card",
                "card IS NULL OR " + Checks.Length("card", 1, 50)
            );
            table.HasCheckConstraint(
                "ck_captured_purchases_references",
                "(entry_id IS NULL OR "
                    + Checks.Length("entry_id", 1, 100)
                    + ") AND (household_id IS NULL OR "
                    + Checks.Length("household_id", 1, 100)
                    + ")"
            );
        });
        builder.HasKey(item => item.Id);
        builder.HasIndex(item => new { item.UserId, item.IdempotencyKey }).IsUnique();
        builder.HasIndex(item => new
        {
            item.UserId,
            item.Status,
            item.CapturedAt,
        });
        builder.HasOne<User>().WithMany().HasForeignKey(item => item.UserId);
    }
}
