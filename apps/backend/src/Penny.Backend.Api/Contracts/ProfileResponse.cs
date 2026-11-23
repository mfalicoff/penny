using System.Text.Json.Serialization;
using Penny.Backend.Api.Profiles;
using Penny.Backend.Application.Profiles;

namespace Penny.Backend.Api.Contracts;

// Contract schema `Profile` (MAZ-171). `displayName`, `avatarUrl` and `provider` are
// omitted when absent; `signIn` is "password" or "oidc".
public sealed record ProfileResponse(
    string UserId,
    string Email,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? DisplayName,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? AvatarUrl,
    bool NameEditable,
    bool AvatarEditable,
    bool NeedsName,
    string SignIn,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Provider
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
            profile.Provider
        );
}
