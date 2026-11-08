using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class OidcIdentityMapping : IEntityTypeConfiguration<OidcIdentity>
{
    public void Configure(EntityTypeBuilder<OidcIdentity> builder)
    {
        builder.ToTable("oidc_identities");
        builder.HasKey(identity => new { identity.Issuer, identity.Subject });
        builder.HasOne<User>().WithMany().HasForeignKey(identity => identity.UserId);
    }
}
