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
                table.HasCheckConstraint(
                    "ck_push_devices_platform",
                    "platform IN ('ios','android')"
                )
        );
        builder.HasKey(device => device.Token);
        builder.HasOne<User>().WithMany().HasForeignKey(device => device.UserId);
        builder
            .HasOne<Session>()
            .WithMany()
            .HasForeignKey(device => device.SessionHash)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
