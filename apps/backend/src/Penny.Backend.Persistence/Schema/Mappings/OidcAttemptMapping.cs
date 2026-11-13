using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class OidcAttemptMapping : IEntityTypeConfiguration<OidcAttempt>
{
    public void Configure(EntityTypeBuilder<OidcAttempt> builder)
    {
        builder.ToTable(
            "oidc_attempts",
            table =>
            {
                table.HasCheckConstraint(
                    "CK_oidc_attempts_transaction_hash",
                    "transaction_hash ~ '^[0-9a-f]{64}$'"
                );
                table.HasCheckConstraint(
                    "CK_oidc_attempts_redirect_uri",
                    Checks.Length("redirect_uri", 1, 2048)
                );
                table.HasCheckConstraint("CK_oidc_attempts_state", Checks.Length("state", 1, 256));
                table.HasCheckConstraint("CK_oidc_attempts_nonce", Checks.Length("nonce", 1, 256));
                table.HasCheckConstraint(
                    "CK_oidc_attempts_code_verifier",
                    Checks.Length("code_verifier", 43, 128)
                );
            }
        );
        builder.HasKey(attempt => attempt.TransactionHash);
        builder.HasIndex(attempt => attempt.ExpiresAt);
    }
}
