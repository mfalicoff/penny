using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class HouseholdRecurringMapping : IEntityTypeConfiguration<HouseholdRecurring>
{
    public void Configure(EntityTypeBuilder<HouseholdRecurring> builder)
    {
        builder.ToTable(
            "household_recurring",
            table =>
            {
                table.HasCheckConstraint(
                    "ck_household_recurring_total",
                    Checks.Cents("total_cents", 1)
                );
                table.HasCheckConstraint(
                    "ck_household_recurring_split_mode",
                    Checks.In("split_mode", Checks.SplitModes)
                );
                table.HasCheckConstraint(
                    "ck_household_recurring_category_name",
                    Checks.Length("category_name", 1, 50)
                );
                table.HasCheckConstraint(
                    "ck_household_recurring_category_icon",
                    Checks.Length("category_icon", 0, 80)
                );
                table.HasCheckConstraint(
                    "ck_household_recurring_category_color",
                    Checks.Color("category_color")
                );
                table.HasCheckConstraint(
                    "ck_household_recurring_note",
                    Checks.Length("note", 0, 1000)
                );
                table.HasCheckConstraint(
                    "ck_household_recurring_frequency",
                    Checks.In("frequency", Checks.Frequencies)
                );
                table.HasCheckConstraint(
                    "ck_household_recurring_anchor_day",
                    Checks.AnchorDay("anchor_day")
                );
                table.HasCheckConstraint(
                    "ck_household_recurring_revision",
                    Checks.Revision("revision")
                );
                table.HasCheckConstraint("ck_household_recurring_lease", Checks.Lease);
            }
        );
        builder.HasKey(rule => rule.Id);
        builder.HasOne<Household>().WithMany().HasForeignKey(rule => rule.HouseholdId);
        builder.HasOne<User>().WithMany().HasForeignKey(rule => rule.PayerId);
        builder.HasOne<User>().WithMany().HasForeignKey(rule => rule.CreatedBy);
        builder.HasOne<Receipt>().WithMany().HasForeignKey(rule => rule.ReceiptId);
        builder
            .HasIndex(rule => rule.NextDate)
            .HasFilter("active")
            .HasDatabaseName("ix_household_recurring_due");
        // account_id names the payer's personal account; validated by the application.
    }
}
