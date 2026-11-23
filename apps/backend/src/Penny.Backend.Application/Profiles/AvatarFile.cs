namespace Penny.Backend.Application.Profiles;

// A stored, re-encoded picture: always WebP, square, metadata removed.
public sealed record AvatarFile(byte[] Content, string Mime, string Version)
{
    public override string ToString() => $"Avatar {Version} ({Content.Length} bytes)";
}
