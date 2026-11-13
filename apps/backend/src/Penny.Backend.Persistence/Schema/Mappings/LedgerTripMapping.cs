using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class LedgerTripMapping : IEntityTypeConfiguration<LedgerTrip>
{
    public void Configure(EntityTypeBuilder<LedgerTrip> builder)
    {
        builder.ToTable(
            "ledger_trips",
            table =>
            {
                table.HasCheckConstraint("ck_ledger_trips_id", Checks.Length("id", 1, 100));
                table.HasCheckConstraint("ck_ledger_trips_name", Checks.Length("name", 1, 80));
                table.HasCheckConstraint("ck_ledger_trips_dates", "end_date >= start_date");
            }
        );
        builder.HasKey(trip => new { trip.UserId, trip.Id });
        builder.HasOne<Ledger>().WithMany().HasForeignKey(trip => trip.UserId);
        // The only link from a personal ledger to a shared trip household.
        builder.HasOne<Household>().WithMany().HasForeignKey(trip => trip.SharedHouseholdId);
    }
}
