namespace Penny.Backend.Api.Contracts;

// A configured sign-in provider (MAZ-170). `icon` names a built-in glyph (`google`,
// `apple`, `sso`, ...); clients show their generic one for a name they don't know. `native`
// says the app may use the platform's own sign-in (Sign in with Apple) for this provider.
public sealed record OidcProviderResponse(string Id, string Label, string Icon, bool Native);
