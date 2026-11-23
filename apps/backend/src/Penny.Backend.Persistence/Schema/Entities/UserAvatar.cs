namespace Penny.Backend.Persistence.Schema.Entities;

// A user's picture (MAZ-171), re-encoded on this server: a square WebP of at most 512 px
// with no metadata. `users.avatar_version` names the current one.
public sealed class UserAvatar
{
    public required string UserId { get; set; }
    public required byte[] Content { get; set; }
    public required string Mime { get; set; }
}
