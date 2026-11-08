using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class LedgerRecurringMapping : IEntityTypeConfiguration<LedgerRecurring>
{
    public void Configure(EntityTypeBuilder<LedgerRecurring> builder)
    {
        builder.ToTable(
            "ledger_recurring",
            table =>
            {
                table.HasCheckConstraint("ck_ledger_recurring_id", Checks.Length("id", 1, 100));
                table.HasCheckConstraint(
                    "ck_ledger_recurring_title",
                    Checks.Length("title", 1, 100)
                );
                table.HasCheckConstraint(
                    "ck_ledger_recurring_kind",
                    Checks.In("kind", Checks.Kinds)
                );
                table.HasCheckConstraint(
                    "ck_ledger_recurring_total",
                    Checks.Cents("total_cents", 1)
                );
                table.HasCheckConstraint(
                    "ck_ledger_recurring_share",
                    "share_cents BETWEEN 0 AND total_cents"
                );
                table.HasCheckConstraint(
                    "ck_ledger_recurring_note",
                    Checks.Length("note", 0, 1000)
                );
                table.HasCheckConstraint(
                    "ck_ledger_recurring_frequency",
                    Checks.In("frequency", Checks.Frequencies)
                );
                table.HasCheckConstraint(
                    "ck_ledger_recurring_anchor_day",
                    Checks.AnchorDay("anchor_day")
                );
            }
        );
        builder.HasKey(rule => new { rule.UserId, rule.Id });
        builder.HasOne<Ledger>().WithMany().HasForeignKey(rule => rule.UserId);
        builder
            .HasOne<LedgerCategory>()
            .WithMany()
            .HasForeignKey(rule => new { rule.UserId, rule.CategoryId });
        builder
            .HasOne<LedgerAccount>()
            .WithMany()
            .HasForeignKey(rule => new { rule.UserId, rule.AccountId });
    }
}
