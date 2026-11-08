using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class HouseholdMemberPeriodMapping : IEntityTypeConfiguration<HouseholdMemberPeriod>
{
    public void Configure(EntityTypeBuilder<HouseholdMemberPeriod> builder)
    {
        builder.ToTable(
            "household_member_periods",
            table =>
                table.HasCheckConstraint(
                    "ck_household_member_periods_order",
                    "left_at IS NULL OR left_at >= joined_at"
                )
        );
        builder.HasKey(period => period.Id);
        builder.HasOne<Household>().WithMany().HasForeignKey(period => period.HouseholdId);
        builder.HasOne<User>().WithMany().HasForeignKey(period => period.UserId);
        // Single membership table: a current member is exactly one open period.
        builder
            .HasIndex(period => new { period.HouseholdId, period.UserId })
            .IsUnique()
            .HasFilter("left_at IS NULL")
            .HasDatabaseName("ix_household_member_periods_open");
        builder.HasIndex(period => new
        {
            period.HouseholdId,
            period.UserId,
            period.JoinedAt,
        });
    }
}
