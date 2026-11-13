using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class PasswordResetMapping : IEntityTypeConfiguration<PasswordReset>
{
    public void Configure(EntityTypeBuilder<PasswordReset> builder)
    {
        builder.ToTable(
            "password_resets",
            table =>
            {
                table.HasCheckConstraint(
                    "CK_password_resets_token_hash",
                    "token_hash ~ '^[0-9a-f]{64}$'"
                );
                table.HasCheckConstraint("CK_password_resets_expiry", "expires_at > created_at");
            }
        );
        builder.HasKey(reset => reset.TokenHash);
        // Issuing a code supersedes the user's earlier one; at most one may exist.
        builder.HasOne<User>().WithMany().HasForeignKey(reset => reset.UserId);
        builder.HasIndex(reset => reset.UserId).IsUnique();
        builder.HasIndex(reset => reset.ExpiresAt);
    }
}
