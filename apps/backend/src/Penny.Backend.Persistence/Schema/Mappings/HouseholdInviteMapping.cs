using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class HouseholdInviteMapping : IEntityTypeConfiguration<HouseholdInvite>
{
    public void Configure(EntityTypeBuilder<HouseholdInvite> builder)
    {
        builder.ToTable("household_invites");
        builder.HasKey(invite => invite.CodeHash);
        builder.HasOne<Household>().WithMany().HasForeignKey(invite => invite.HouseholdId);
        builder.HasIndex(invite => invite.ExpiresAt);
    }
}
