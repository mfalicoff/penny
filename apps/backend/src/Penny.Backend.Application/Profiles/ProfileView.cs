namespace Penny.Backend.Application.Profiles;

// The signed-in person's own profile. `AvatarVersion` changes with every new picture, so
// clients can cache the picture's URL for good. `NeedsName`: the apps ask for a name.
// `PasswordChangedAt`: when a password account last changed its password, if ever.
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
    DateTimeOffset? PasswordChangedAt = null
);
