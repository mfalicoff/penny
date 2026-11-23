using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Profiles;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Repositories;

public sealed class PostgresProfileRepository(NpgsqlDataSource source) : IProfileRepository
{
    public async Task<StoredProfile?> FindAsync(string userId, CancellationToken cancellationToken)
    {
        await using var context = PennyDbContext.Create(source);
        return await context
            .Users.AsNoTracking()
            .Where(user => user.Id == userId)
            .Select(user => new StoredProfile(
                user.Id,
                user.Email,
                user.DisplayName,
                user.NameFromProvider,
                user.AvatarFromProvider,
                user.NamePromptDismissed,
                context
                    .OidcIdentities.Where(identity => identity.UserId == user.Id)
                    .Select(identity => identity.Issuer)
                    .FirstOrDefault(),
                user.AvatarVersion,
                user.AvatarSourceHash,
                user.PasswordChangedAt
            ))
            .SingleOrDefaultAsync(cancellationToken);
    }

    public async Task<bool> TrySetNameAsync(
        string userId,
        string? name,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        return await context
                .Users.Where(user => user.Id == userId && !user.NameFromProvider)
                .ExecuteUpdateAsync(
                    set => set.SetProperty(user => user.DisplayName, name),
                    cancellationToken
                ) == 1;
    }

    public async Task DismissNamePromptAsync(string userId, CancellationToken cancellationToken)
    {
        await using var context = PennyDbContext.Create(source);
        await context
            .Users.Where(user => user.Id == userId)
            .ExecuteUpdateAsync(
                set => set.SetProperty(user => user.NamePromptDismissed, true),
                cancellationToken
            );
    }

    public async Task<bool> TrySetAvatarAsync(
        string userId,
        AvatarFile? avatar,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await using var transaction = await context.Database.BeginTransactionAsync(
            cancellationToken
        );
        // The guarded update locks the user row, so a concurrent provider sign-in either
        // commits first (and this fails) or waits for this picture.
        var updated = await context
            .Users.Where(user => user.Id == userId && !user.AvatarFromProvider)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(
                            user => user.AvatarVersion,
                            avatar == null ? null : avatar.Version
                        )
                        .SetProperty(user => user.AvatarSourceHash, (byte[]?)null),
                cancellationToken
            );
        if (updated != 1)
            return false;
        await ReplaceAsync(context, userId, avatar, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    public async Task SetProviderNameAsync(
        string userId,
        string name,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await context
            .Users.Where(user => user.Id == userId)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(user => user.DisplayName, name)
                        .SetProperty(user => user.NameFromProvider, true),
                cancellationToken
            );
    }

    public async Task SetProviderAvatarAsync(
        string userId,
        AvatarFile? avatar,
        byte[] sourceHash,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await using var transaction = await context.Database.BeginTransactionAsync(
            cancellationToken
        );
        if (avatar is null)
        {
            // The download failed: the picture becomes the provider's, and the stored one
            // stays until a later sign-in copies the provider's.
            await context
                .Users.Where(user => user.Id == userId)
                .ExecuteUpdateAsync(
                    set => set.SetProperty(user => user.AvatarFromProvider, true),
                    cancellationToken
                );
        }
        else
        {
            await context
                .Users.Where(user => user.Id == userId)
                .ExecuteUpdateAsync(
                    set =>
                        set.SetProperty(user => user.AvatarFromProvider, true)
                            .SetProperty(user => user.AvatarVersion, avatar.Version)
                            .SetProperty(user => user.AvatarSourceHash, sourceHash),
                    cancellationToken
                );
            await ReplaceAsync(context, userId, avatar, cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<AvatarFile?> ReadAvatarAsync(
        string viewerId,
        string userId,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        var periods = context.HouseholdMemberPeriods;
        // Privacy rule: only people who share a household or trip see each other. The
        // viewer must be a current member of a household the person is or was in (their
        // name stays in its history).
        var visible =
            viewerId == userId
            || await periods.AnyAsync(
                viewer =>
                    viewer.UserId == viewerId
                    && viewer.LeftAt == null
                    && periods.Any(person =>
                        person.HouseholdId == viewer.HouseholdId && person.UserId == userId
                    ),
                cancellationToken
            );
        if (!visible)
            return null;
        return await context
            .Users.AsNoTracking()
            .Where(user => user.Id == userId && user.AvatarVersion != null)
            .Join(
                context.UserAvatars,
                user => user.Id,
                avatar => avatar.UserId,
                (user, avatar) => new AvatarFile(avatar.Content, avatar.Mime, user.AvatarVersion!)
            )
            .SingleOrDefaultAsync(cancellationToken);
    }

    private static async Task ReplaceAsync(
        PennyDbContext context,
        string userId,
        AvatarFile? avatar,
        CancellationToken cancellationToken
    )
    {
        await context
            .UserAvatars.Where(row => row.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
        if (avatar is null)
            return;
        context.UserAvatars.Add(
            new UserAvatar
            {
                UserId = userId,
                Content = avatar.Content,
                Mime = avatar.Mime,
            }
        );
        await context.SaveChangesAsync(cancellationToken);
    }
}
