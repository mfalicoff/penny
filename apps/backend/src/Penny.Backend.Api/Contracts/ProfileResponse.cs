using System.Text.Json.Serialization;
using Penny.Backend.Api.Profiles;
using Penny.Backend.Application.Profiles;

namespace Penny.Backend.Api.Contracts;

// Contract schema `Profile` (MAZ-171). `displayName`, `avatarUrl` and `provider` are
// omitted when absent; `signIn` is "password" or "oidc". `passwordChangedAt` (Unix ms) is when
// a password account last changed its password, omitted before the first change.
// `emailVerified` says whether the current email is proven (MAZ-172) and `emailVerifiedAt`
// (Unix ms) when; clients show the unverified state only while the server sends email.
// `providerId` and `providerIcon` (MAZ-170) match the account's entry in `GET /api/auth/oidc`.
public sealed record ProfileResponse(
    string UserId,
    string Email,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? DisplayName,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? AvatarUrl,
    bool NameEditable,
    bool AvatarEditable,
    bool NeedsName,
    string SignIn,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Provider,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? PasswordChangedAt,
    bool EmailVerified,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? EmailVerifiedAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ProviderId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ProviderIcon
)
{
    public static ProfileResponse From(ProfileView profile) =>
        new(
            profile.UserId,
            profile.Email,
            profile.DisplayName,
            AvatarLink.UrlFor(profile.UserId, profile.AvatarVersion),
            profile.NameEditable,
            profile.AvatarEditable,
            profile.NeedsName,
            profile.SignIn == SignInMethod.Oidc ? "oidc" : "password",
            profile.Provider,
            profile.PasswordChangedAt?.ToUnixTimeMilliseconds(),
            profile.EmailVerifiedAt is not null,
            profile.EmailVerifiedAt?.ToUnixTimeMilliseconds(),
            profile.ProviderId,
            profile.ProviderIcon
        );
}
