namespace Penny.Backend.Application.Authentication;

// The configured sign-in providers, in display order (MAZ-170). Client credentials stay with
// the provider adapters.
public sealed record OidcSettings(IReadOnlyList<OidcProviderSettings> Providers)
{
    public OidcProviderSettings? Find(string id) =>
        Providers.FirstOrDefault(provider =>
            string.Equals(provider.Id, id, StringComparison.Ordinal)
        );

    // The provider an account signs in with, found by its stored issuer.
    public OidcProviderSettings? ForIssuer(string issuer) =>
        Providers.FirstOrDefault(provider =>
            string.Equals(provider.Issuer, issuer, StringComparison.Ordinal)
        );
}
