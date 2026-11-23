using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class UserAvatarMapping : IEntityTypeConfiguration<UserAvatar>
{
    public void Configure(EntityTypeBuilder<UserAvatar> builder)
    {
        builder.ToTable("user_avatars", table =>
        {
            table.HasCheckConstraint("ck_user_avatars_mime", "mime = 'image/webp'");
            // AvatarFormat: 512 x 512 WebP stays far below 1 MiB.
            table.HasCheckConstraint(
                "ck_user_avatars_content",
                "length(content) BETWEEN 1 AND 1048576"
            );
        });
        builder.HasKey(avatar => avatar.UserId);
        // The picture goes with the account.
        builder
            .HasOne<User>()
            .WithOne()
            .HasForeignKey<UserAvatar>(avatar => avatar.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
