using System.Text.Json.Serialization;
using Penny.Backend.Api.Profiles;
using Penny.Backend.Application.Profiles;

namespace Penny.Backend.Api.Contracts;

// Contract schema `Me`: who is signed in, with the profile summary the apps' chrome shows
// (MAZ-171). `displayName` and `avatarUrl` are omitted when absent. `Profile` has the rest.
public sealed record MeResponse(
    string Email,
    string UserId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? DisplayName,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? AvatarUrl,
    bool NeedsName
)
{
    public static MeResponse From(ProfileView profile) =>
        new(
            profile.Email,
            profile.UserId,
            profile.DisplayName,
            AvatarLink.UrlFor(profile.UserId, profile.AvatarVersion),
            profile.NeedsName
        );
}
