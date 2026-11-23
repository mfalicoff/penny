namespace Penny.Backend.Application.Abstractions.Profiles;

// Decodes an untrusted picture in a sandboxed process and returns it as a square WebP of
// at most `AvatarFormat.MaxSide` px with no metadata, or null when it can't be decoded,
// is smaller than `AvatarFormat.MinSide` or larger than `AvatarFormat.MaxPixels`.
public interface IAvatarImageProcessor
{
    Task<byte[]?> ProcessAsync(ReadOnlyMemory<byte> image, CancellationToken cancellationToken);
}
