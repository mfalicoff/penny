using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class UserMapping : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.ToTable("users", table =>
        {
            // DisplayName.MaxLength is in UTF-16 code units, so never more code points.
            table.HasCheckConstraint(
                "ck_users_display_name",
                "display_name IS NULL OR " + Checks.Length("display_name", 1, 60)
            );
            table.HasCheckConstraint(
                "ck_users_avatar_version",
                "avatar_version IS NULL OR avatar_version ~ '^[0-9a-f]{32}$'"
            );
            table.HasCheckConstraint(
                "ck_users_avatar_source_hash",
                "avatar_source_hash IS NULL OR length(avatar_source_hash) = 32"
            );
        });
        builder.HasKey(user => user.Id);
        builder.HasIndex(user => user.Email).IsUnique();
        // Accounts created before profiles have no name, a person-managed name and picture,
        // and haven't skipped the prompt.
        builder.Property(user => user.NameFromProvider).HasDefaultValue(false);
        builder.Property(user => user.AvatarFromProvider).HasDefaultValue(false);
        builder.Property(user => user.NamePromptDismissed).HasDefaultValue(false);
    }
}
