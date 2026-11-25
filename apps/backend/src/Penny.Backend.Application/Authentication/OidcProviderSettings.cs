namespace Penny.Backend.Application.Authentication;

// Provider-independent policy for one configured provider. `Relayed` providers redirect to
// this API's callback, which hands the response on to the app's redirect; `Native` ones
// also accept ID tokens from the platform's own sign-in (Sign in with Apple on iOS).
public sealed record OidcProviderSettings(
    string Id,
    string Issuer,
    string Label,
    string Icon,
    IReadOnlyList<string> RedirectUris,
    bool AllowRegistration,
    bool Relayed = false,
    bool Native = false
);
