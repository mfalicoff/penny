using Microsoft.IdentityModel.Protocols;

namespace Penny.Backend.Api.Authentication;

// Fetches discovery and JWKS documents over HTTPS with the named provider client, so
// handler lifetime, timeouts and size limits come from IHttpClientFactory.
public sealed class OidcDocumentRetriever(IHttpClientFactory clients) : IDocumentRetriever
{
    public Task<string> GetDocumentAsync(string address, CancellationToken cancel) =>
        new HttpDocumentRetriever(clients.CreateClient(OidcProviderClient.HttpClientName))
        {
            RequireHttps = true,
            SendAdditionalHeaderData = false,
        }.GetDocumentAsync(address, cancel);
}
