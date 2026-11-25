namespace Penny.Backend.Application.Profiles;

// The signed-in person's own profile. `AvatarVersion` changes with every new picture, so
// clients can cache the picture's URL for good. `NeedsName`: the apps ask for a name.
// `PasswordChangedAt`: when a password account last changed its password, if ever.
// `EmailVerifiedAt`: when the current email was proven (MAZ-172), null while unverified.
// `Provider`, `ProviderId` and `ProviderIcon` describe the configured provider an oidc account
// signs in with (MAZ-170), null when none is configured for its issuer any more.
public sealed record ProfileView(
    string UserId,
    string Email,
    string? DisplayName,
    string? AvatarVersion,
    bool NameEditable,
    bool AvatarEditable,
    bool NeedsName,
    SignInMethod SignIn,
    string? Provider,
    DateTimeOffset? PasswordChangedAt = null,
    DateTimeOffset? EmailVerifiedAt = null,
    string? ProviderId = null,
    string? ProviderIcon = null
);
