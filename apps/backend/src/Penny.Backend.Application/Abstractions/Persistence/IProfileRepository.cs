using Penny.Backend.Application.Profiles;

namespace Penny.Backend.Application.Abstractions.Persistence;

public interface IProfileRepository
{
    Task<StoredProfile?> FindAsync(string userId, CancellationToken cancellationToken);

    // Person-set name (null clears it). False when a provider manages the name, checked in
    // the same statement so a concurrent provider sign-in wins.
    Task<bool> TrySetNameAsync(string userId, string? name, CancellationToken cancellationToken);

    Task DismissNamePromptAsync(string userId, CancellationToken cancellationToken);

    // Person-set picture (null removes it). False when a provider manages the picture.
    Task<bool> TrySetAvatarAsync(
        string userId,
        AvatarFile? avatar,
        CancellationToken cancellationToken
    );

    // Provider-managed fields from a sign-in: marks the field as the provider's and stores
    // the value. A null `avatar` marks the picture as the provider's and keeps the stored one.
    Task SetProviderNameAsync(string userId, string name, CancellationToken cancellationToken);
    Task SetProviderAvatarAsync(
        string userId,
        AvatarFile? avatar,
        byte[] sourceHash,
        CancellationToken cancellationToken
    );

    // The picture of `userId` as `viewerId` may see it: their own, or that of someone who is
    // or was a member of a household the viewer is a current member of. Null otherwise, or
    // when there is no picture.
    Task<AvatarFile?> ReadAvatarAsync(
        string viewerId,
        string userId,
        CancellationToken cancellationToken
    );
}
