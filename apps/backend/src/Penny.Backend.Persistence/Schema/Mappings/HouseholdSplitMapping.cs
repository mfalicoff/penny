using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class HouseholdSplitMapping : IEntityTypeConfiguration<HouseholdSplit>
{
    public void Configure(EntityTypeBuilder<HouseholdSplit> builder)
    {
        builder.ToTable(
            "household_splits",
            table =>
                table.HasCheckConstraint("ck_household_splits_amount", Checks.Cents("amount_cents"))
        );
        builder.HasKey(split => new { split.ExpenseId, split.UserId });
        builder.HasOne<HouseholdExpense>().WithMany().HasForeignKey(split => split.ExpenseId);
        builder.HasOne<User>().WithMany().HasForeignKey(split => split.UserId);
    }
}
