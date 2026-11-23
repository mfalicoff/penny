using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class EmailVerificationMapping : IEntityTypeConfiguration<EmailVerification>
{
    public void Configure(EntityTypeBuilder<EmailVerification> builder)
    {
        builder.ToTable("email_verifications", table =>
        {
            table.HasCheckConstraint(
                "CK_email_verifications_token_hash",
                "token_hash ~ '^[0-9a-f]{64}$'"
            );
            table.HasCheckConstraint("CK_email_verifications_expiry", "expires_at > created_at");
            table.HasCheckConstraint(
                "CK_email_verifications_email",
                Checks.Length("email", 3, 254)
            );
        });
        builder.HasKey(verification => verification.TokenHash);
        // Sending a code supersedes the user's earlier one; at most one may exist.
        builder
            .HasOne<User>()
            .WithMany()
            .HasForeignKey(verification => verification.UserId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(verification => verification.UserId).IsUnique();
        builder.HasIndex(verification => verification.ExpiresAt);
    }
}
