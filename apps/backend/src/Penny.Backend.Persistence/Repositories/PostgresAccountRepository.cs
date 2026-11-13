using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Repositories;

public sealed class PostgresAccountRepository(NpgsqlDataSource source) : IAccountRepository
{
    // EF names the unique email index; a violation means the email is already taken.
    private const string EmailIndex = "IX_users_email";

    // The (issuer, subject) primary key; a violation means the identity already exists.
    private const string IdentityKey = "PK_oidc_identities";

    public async Task<StoredUser?> FindByEmailAsync(
        string email,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        return await context
            .Users.AsNoTracking()
            .Where(user => user.Email == email)
            .Select(user => new StoredUser(user.Id, user.Email, user.Password))
            .SingleOrDefaultAsync(cancellationToken);
    }

    public async Task<StoredUser?> FindByIdentityAsync(
        string issuer,
        string subject,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        return await context
            .OidcIdentities.AsNoTracking()
            .Where(identity => identity.Issuer == issuer && identity.Subject == subject)
            .Join(
                context.Users,
                identity => identity.UserId,
                user => user.Id,
                (_, user) => new StoredUser(user.Id, user.Email, user.Password)
            )
            .SingleOrDefaultAsync(cancellationToken);
    }

    public async Task<string?> FindEmailAsync(string userId, CancellationToken cancellationToken)
    {
        await using var context = PennyDbContext.Create(source);
        return await context
            .Users.AsNoTracking()
            .Where(user => user.Id == userId)
            .Select(user => user.Email)
            .SingleOrDefaultAsync(cancellationToken);
    }

    public async Task UpdatePasswordAsync(
        string userId,
        string currentHash,
        string newHash,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await context
            .Users.Where(user => user.Id == userId && user.Password == currentHash)
            .ExecuteUpdateAsync(
                set => set.SetProperty(user => user.Password, newHash),
                cancellationToken
            );
    }

    public async Task<bool> TryCreateAsync(
        StoredUser user,
        StoredLedger ledger,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        AddAccount(context, user, ledger);
        // One SaveChanges is one transaction. A concurrent insert of the same email
        // waits on the unique index and fails once the first registration commits.
        return await TrySaveAsync(context, [EmailIndex], cancellationToken);
    }

    public async Task<bool> TryCreateOidcAsync(
        StoredUser user,
        string issuer,
        string subject,
        StoredLedger ledger,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        AddAccount(context, user, ledger);
        context.OidcIdentities.Add(
            new OidcIdentity
            {
                Issuer = issuer,
                Subject = subject,
                UserId = user.Id,
            }
        );
        // A concurrent first sign-in for the same identity (or email) waits on the
        // unique index and fails once the first one commits; all rows roll back.
        return await TrySaveAsync(context, [EmailIndex, IdentityKey], cancellationToken);
    }

    private static void AddAccount(PennyDbContext context, StoredUser user, StoredLedger ledger)
    {
        context.Users.Add(
            new User
            {
                Id = user.Id,
                Email = user.Email,
                Password = user.Password,
            }
        );
        context.Ledgers.Add(
            new Ledger
            {
                UserId = user.Id,
                Currency = ledger.Currency,
                Revision = ledger.Revision,
            }
        );
        context.LedgerCategories.AddRange(
            ledger.Categories.Select(category => new LedgerCategory
            {
                UserId = user.Id,
                Id = category.Id,
                Name = category.Name,
                Icon = category.Icon,
                Color = category.Color,
                Kind = category.Kind,
            })
        );
    }

    private static async Task<bool> TrySaveAsync(
        PennyDbContext context,
        string[] duplicateConstraints,
        CancellationToken cancellationToken
    )
    {
        try
        {
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException error)
            when (error.InnerException
                    is PostgresException
                    {
                        SqlState: PostgresErrorCodes.UniqueViolation,
                        ConstraintName: { } constraint,
                    }
                && duplicateConstraints.Contains(constraint, StringComparer.Ordinal)
            )
        {
            return false;
        }
    }
}
