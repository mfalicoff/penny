using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class HouseholdRecurringAllocationMapping
    : IEntityTypeConfiguration<HouseholdRecurringAllocation>
{
    public void Configure(EntityTypeBuilder<HouseholdRecurringAllocation> builder)
    {
        builder.ToTable(
            "household_recurring_allocations",
            table =>
            {
                // Exact allocations carry cents; percent allocations carry basis points.
                table.HasCheckConstraint(
                    "ck_household_recurring_allocations_one_value",
                    "(amount_cents IS NULL) <> (percent_basis_points IS NULL)"
                );
                table.HasCheckConstraint(
                    "ck_household_recurring_allocations_amount",
                    "amount_cents IS NULL OR " + Checks.Cents("amount_cents")
                );
                table.HasCheckConstraint(
                    "ck_household_recurring_allocations_percent",
                    "percent_basis_points IS NULL OR percent_basis_points BETWEEN 0 AND 10000"
                );
            }
        );
        builder.HasKey(allocation => new { allocation.RecurringId, allocation.UserId });
        builder
            .HasOne<HouseholdRecurring>()
            .WithMany()
            .HasForeignKey(allocation => allocation.RecurringId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<User>().WithMany().HasForeignKey(allocation => allocation.UserId);
    }
}
