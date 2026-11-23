using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class HouseholdEmailInviteMapping : IEntityTypeConfiguration<HouseholdEmailInvite>
{
    public void Configure(EntityTypeBuilder<HouseholdEmailInvite> builder)
    {
        builder.ToTable("household_email_invites", table =>
        {
            table.HasCheckConstraint(
                "ck_household_email_invites_code_hash",
                "code_hash IS NULL OR code_hash ~ '^[0-9a-f]{64}$'"
            );
            table.HasCheckConstraint(
                "ck_household_email_invites_email",
                Checks.Length("email", 3, 254)
            );
            table.HasCheckConstraint(
                "ck_household_email_invites_code",
                "(code_hash IS NULL) = (expires_at IS NULL)"
            );
        });
        builder.HasKey(invite => invite.Id);
        builder.HasOne<Household>().WithMany().HasForeignKey(invite => invite.HouseholdId);
        builder.HasOne<User>().WithMany().HasForeignKey(invite => invite.InvitedBy);
        // Inviting an address again reuses its row (a resend).
        builder.HasIndex(invite => new { invite.HouseholdId, invite.Email }).IsUnique();
        builder.HasIndex(invite => invite.CodeHash).IsUnique().HasFilter("code_hash IS NOT NULL");
    }
}
