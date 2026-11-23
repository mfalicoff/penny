namespace Penny.Backend.Application.Abstractions.Profiles;

// Downloads a sign-in provider's picture once, so other people's screens never load the
// provider's URL. Returns the bytes and their declared MIME type, or null on any
// failure (not https, too large, too slow, not an image).
public interface IProviderPictureSource
{
    Task<(byte[] Content, string Mime)?> FetchAsync(Uri url, CancellationToken cancellationToken);
}
