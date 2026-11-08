namespace Penny.Backend.Application.Authentication;

// Provider-independent OIDC policy. Client credentials stay with the provider adapter.
public sealed record OidcSettings(
    string Issuer,
    string Label,
    IReadOnlyList<string> RedirectUris,
    bool AllowRegistration
);
