using System.Net;
using Penny.Backend.Application.Abstractions.Profiles;
using Penny.Backend.Application.Profiles;

namespace Penny.Backend.Api.Authentication;

// Copies a sign-in provider's `picture` (MAZ-171) at sign-in, so other people's screens
// never load the provider's URL. https only (also after redirects, which HttpClient never
// follows to http), no cookies or credentials, a 5-second bound, and at most 10 MiB. The
// URL comes from the configured issuer's signed ID token (or its UserInfo). Calls are not
// logged: picture URLs can identify the person.
public sealed class ProviderPictureClient(IHttpClientFactory clients) : IProviderPictureSource
{
    public const string HttpClientName = "penny-provider-picture";

    public async Task<(byte[] Content, string Mime)?> FetchAsync(
        Uri url,
        CancellationToken cancellationToken
    )
    {
        if (url.Scheme != Uri.UriSchemeHttps)
            return null;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Accept.ParseAdd("image/*");
            using var response = await clients
                .CreateClient(HttpClientName)
                .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            var mime = response.Content.Headers.ContentType?.MediaType?.ToLowerInvariant();
            if (
                response.StatusCode != HttpStatusCode.OK
                || response.RequestMessage?.RequestUri?.Scheme != Uri.UriSchemeHttps
                || mime is null
                || !AvatarFormat.Mimes.Contains(mime, StringComparer.Ordinal)
                || response.Content.Headers.ContentLength > AvatarFormat.MaxBytes
            )
                return null;
            await using var body = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var buffer = new MemoryStream();
            var chunk = new byte[81920];
            int read;
            while ((read = await body.ReadAsync(chunk, cancellationToken)) > 0)
            {
                if (buffer.Length + read > AvatarFormat.MaxBytes)
                    return null;
                buffer.Write(chunk, 0, read);
            }
            return (buffer.ToArray(), mime);
        }
        catch (Exception error)
            when (error is not OperationCanceledException
                || !cancellationToken.IsCancellationRequested
            )
        {
            return null;
        }
    }
}
