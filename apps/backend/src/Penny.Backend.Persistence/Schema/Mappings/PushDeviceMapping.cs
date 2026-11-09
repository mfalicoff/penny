using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class PushDeviceMapping : IEntityTypeConfiguration<PushDevice>
{
    public void Configure(EntityTypeBuilder<PushDevice> builder)
    {
        builder.ToTable(
            "push_devices",
            table =>
            {
                table.HasCheckConstraint(
                    "ck_push_devices_platform",
                    "platform IN ('ios','android')"
                );
                // Expo tokens carry no environment; APNs tokens are iOS-only and name the
                // gateway that issued them (MAZ-61).
                table.HasCheckConstraint(
                    "ck_push_devices_provider",
                    "(provider = 'expo' AND environment IS NULL) OR (provider = 'apns' AND platform = 'ios' AND environment IS NOT NULL AND environment IN ('sandbox','production'))"
                );
            }
        );
        builder.HasKey(device => device.Token);
        builder.Property(device => device.Provider).HasDefaultValue("expo");
        builder.HasOne<User>().WithMany().HasForeignKey(device => device.UserId);
        builder
            .HasOne<Session>()
            .WithMany()
            .HasForeignKey(device => device.SessionHash)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
