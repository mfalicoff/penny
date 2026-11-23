using System.Security.Cryptography;
using System.Text;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Abstractions.Profiles;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Application.Profiles;

// Display names and pictures (MAZ-171). A person sets each field unless their sign-in
// provider sends it; a provider-sent field is read only and refreshed at each sign-in. An
// account has one sign-in method, so each field has at most one possible source.
// Pictures are re-encoded on this server; a provider's picture is copied once.
public sealed class ProfileService(
    IProfileRepository profiles,
    IAvatarImageProcessor images,
    OidcSettings? oidc = null,
    IProviderPictureSource? pictures = null
)
{
    public const string InvalidName =
        "Enter a name of 1 to 60 characters, without line breaks or control characters.";
    public const string NameManaged =
        "Your sign-in provider manages your name. Change it with your provider.";
    public const string AvatarManaged =
        "Your sign-in provider manages your picture. Change it with your provider.";
    public const string InvalidPicture = "Choose a PNG, JPEG, HEIC or WebP picture up to 10 MB.";
    public const string UnreadablePicture = "Penny couldn't read this picture. Choose another one.";
    public const string PictureNotFound = "Picture not found.";

    public async Task<ProfileView> GetAsync(string userId, CancellationToken cancellationToken) =>
        View(await FindAsync(userId, cancellationToken));

    // `name`: absent leaves the name alone; a value sets it, and null clears it so the
    // email shows. `dismissPrompt` stops the apps asking for a name.
    public async Task<ProfileView> UpdateAsync(
        string userId,
        Optional<string?> name,
        bool dismissPrompt,
        CancellationToken cancellationToken
    )
    {
        var profile = await FindAsync(userId, cancellationToken);
        if (name.HasValue)
        {
            var normalized = name.Value is null
                ? null
                : DisplayName.Normalize(name.Value)
                    ?? throw new BackendFailure(FailureKind.Invalid, InvalidName);
            if (profile.NameFromProvider)
                throw new BackendFailure(FailureKind.Forbidden, NameManaged);
            if (!await profiles.TrySetNameAsync(userId, normalized, cancellationToken))
                throw new BackendFailure(FailureKind.Forbidden, NameManaged);
        }
        if (dismissPrompt)
            await profiles.DismissNamePromptAsync(userId, cancellationToken);
        return await GetAsync(userId, cancellationToken);
    }

    public async Task<ProfileView> SetAvatarAsync(
        string userId,
        string? mime,
        byte[]? content,
        CancellationToken cancellationToken
    )
    {
        var profile = await FindAsync(userId, cancellationToken);
        if (profile.AvatarFromProvider)
            throw new BackendFailure(FailureKind.Forbidden, AvatarManaged);
        if (content is null || !AvatarFormat.IsAcceptable(mime, content))
            throw new BackendFailure(FailureKind.Invalid, InvalidPicture);
        var encoded = await images.ProcessAsync(content, cancellationToken)
            ?? throw new BackendFailure(FailureKind.Invalid, UnreadablePicture);
        if (!await profiles.TrySetAvatarAsync(userId, NewAvatar(encoded), cancellationToken))
            throw new BackendFailure(FailureKind.Forbidden, AvatarManaged);
        return await GetAsync(userId, cancellationToken);
    }

    public async Task<ProfileView> RemoveAvatarAsync(
        string userId,
        CancellationToken cancellationToken
    )
    {
        var profile = await FindAsync(userId, cancellationToken);
        if (
            profile.AvatarFromProvider
            || !await profiles.TrySetAvatarAsync(userId, null, cancellationToken)
        )
            throw new BackendFailure(FailureKind.Forbidden, AvatarManaged);
        return await GetAsync(userId, cancellationToken);
    }

    // Someone who shares no household with the viewer gets the same 404 as a missing
    // picture, so a picture never confirms that an account exists.
    public async Task<AvatarFile> ReadAvatarAsync(
        string viewerId,
        string userId,
        CancellationToken cancellationToken
    ) =>
        await profiles.ReadAvatarAsync(viewerId, userId, cancellationToken)
        ?? throw new BackendFailure(FailureKind.NotFound, PictureNotFound);

    // Called at every OIDC sign-in. A provider that sends a field takes it over; one that
    // sends nothing leaves the stored value (and who manages it) alone. Picture failures
    // never block sign-in: the previous picture, if any, stays.
    public async Task ApplyProviderAsync(
        string userId,
        ProviderProfile? provider,
        CancellationToken cancellationToken
    )
    {
        if (provider is null)
            return;
        var profile = await FindAsync(userId, cancellationToken);
        if (provider.Name is { } name && (name != profile.DisplayName || !profile.NameFromProvider))
            await profiles.SetProviderNameAsync(userId, name, cancellationToken);
        if (
            pictures is null
            || !Uri.TryCreate(provider.PictureUrl, UriKind.Absolute, out var url)
            || url.Scheme != Uri.UriSchemeHttps
        )
            return;
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(url.AbsoluteUri));
        if (
            profile.AvatarFromProvider
            && profile.AvatarVersion is not null
            && profile.AvatarSourceHash is { } stored
            && CryptographicOperations.FixedTimeEquals(stored, hash)
        )
            return;
        await profiles.SetProviderAvatarAsync(
            userId,
            await ProviderAvatarAsync(url, cancellationToken),
            hash,
            cancellationToken
        );
    }

    private async Task<AvatarFile?> ProviderAvatarAsync(
        Uri url,
        CancellationToken cancellationToken
    )
    {
        var fetched = await pictures!.FetchAsync(url, cancellationToken);
        if (fetched is not { } picture || !AvatarFormat.IsAcceptable(picture.Mime, picture.Content))
            return null;
        var encoded = await images.ProcessAsync(picture.Content, cancellationToken);
        return encoded is null ? null : NewAvatar(encoded);
    }

    private async Task<StoredProfile> FindAsync(
        string userId,
        CancellationToken cancellationToken
    ) =>
        await profiles.FindAsync(userId, cancellationToken)
        ?? throw new BackendFailure(FailureKind.Unauthorized, AuthService.SignInRequired);

    private ProfileView View(StoredProfile profile) =>
        new(
            profile.UserId,
            profile.Email,
            profile.DisplayName,
            profile.AvatarVersion,
            NameEditable: !profile.NameFromProvider,
            AvatarEditable: !profile.AvatarFromProvider,
            NeedsName: profile.DisplayName is null
                && !profile.NameFromProvider
                && !profile.NamePromptDismissed,
            profile.OidcIssuer is null ? SignInMethod.Password : SignInMethod.Oidc,
            profile.OidcIssuer is { } issuer ? ProviderLabel(issuer) : null,
            profile.OidcIssuer is null ? profile.PasswordChangedAt : null
        );

    // The configured display name of the account's own provider, found by its issuer, so
    // several configured providers each name themselves. Null when none is configured
    // for that issuer any more; clients then say "your sign-in provider".
    private string? ProviderLabel(string issuer) =>
        oidc is not null && string.Equals(oidc.Issuer, issuer, StringComparison.Ordinal)
            ? oidc.Label
            : null;

    private static AvatarFile NewAvatar(byte[] encoded) =>
        new(encoded, AvatarFormat.StoredMime, SessionTokens.NewId());
}
