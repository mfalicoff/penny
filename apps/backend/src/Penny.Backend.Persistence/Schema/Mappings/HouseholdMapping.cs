using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class HouseholdMapping : IEntityTypeConfiguration<Household>
{
    public void Configure(EntityTypeBuilder<Household> builder)
    {
        builder.ToTable(
            "households",
            table =>
            {
                table.HasCheckConstraint(
                    "ck_households_currency",
                    Checks.In("currency", Checks.Currencies)
                );
                // A trip household has both dates; a regular household has neither.
                table.HasCheckConstraint(
                    "ck_households_trip",
                    "(trip_start IS NULL) = (trip_end IS NULL) AND (trip_end IS NULL OR trip_end >= trip_start)"
                );
            }
        );
        builder.HasKey(household => household.Id);
        builder.HasOne<User>().WithMany().HasForeignKey(household => household.CreatorId);
    }
}
