using Aspire.Hosting.ApplicationModel;

namespace Penny.Backend.AppHost;

// A registry/image:tag@sha256:digest reference. Aspire pulls by digest when one is set.
public sealed record PinnedImage(string Registry, string Image, string Tag, string Sha256)
{
    // Parses `registry/repository/name:tag@sha256:digest`, the form DatabaseSchema.Image uses.
    public static PinnedImage Parse(string reference)
    {
        var at = reference.IndexOf("@sha256:", StringComparison.Ordinal);
        var slash = reference.IndexOf('/', StringComparison.Ordinal);
        var colon = reference.LastIndexOf(':', at);
        if (at < 0 || slash < 0 || colon < slash)
            throw new FormatException("Expected registry/image:tag@sha256:digest.");
        return new(
            reference[..slash],
            reference[(slash + 1)..colon],
            reference[(colon + 1)..at],
            reference[(at + "@sha256:".Length)..]
        );
    }

    public IResourceBuilder<T> ApplyTo<T>(IResourceBuilder<T> builder)
        where T : ContainerResource =>
        builder.WithImageRegistry(Registry).WithImage(Image, Tag).WithImageSHA256(Sha256);
}
