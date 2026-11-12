using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;
using Penny.Backend.Persistence.Search;

namespace Penny.Backend.Persistence.Repositories;

public sealed class PostgresLedgerRepository(NpgsqlDataSource source) : ILedgerRepository
{
    public async Task<StoredLedger?> ReadAsync(string userId, CancellationToken cancellationToken)
    {
        await using var context = PennyDbContext.Create(source);
        await using var transaction = await context.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.RepeatableRead,
            cancellationToken
        );
        var ledger = await context
            .Ledgers.AsNoTracking()
            .SingleOrDefaultAsync(row => row.UserId == userId, cancellationToken);
        if (ledger is null)
            return null;
        return new(
            ledger.Revision,
            ledger.Currency,
            await context
                .LedgerAccounts.AsNoTracking()
                .Where(row => row.UserId == userId)
                .OrderBy(row => row.Id)
                .Select(row => new StoredAccount(row.Id, row.Name, row.Type))
                .ToListAsync(cancellationToken),
            await context
                .LedgerCategories.AsNoTracking()
                .Where(row => row.UserId == userId)
                .OrderBy(row => row.Id)
                .Select(row => new StoredCategory(row.Id, row.Name, row.Icon, row.Color, row.Kind))
                .ToListAsync(cancellationToken),
            await context
                .LedgerTrips.AsNoTracking()
                .Where(row => row.UserId == userId)
                .OrderBy(row => row.Id)
                .Select(row => new StoredTrip(
                    row.Id,
                    row.Name,
                    row.StartDate,
                    row.EndDate,
                    row.SharedHouseholdId
                ))
                .ToListAsync(cancellationToken),
            await context
                .LedgerRecurring.AsNoTracking()
                .Where(row => row.UserId == userId)
                .OrderBy(row => row.Id)
                .Select(row => new StoredRecurring(
                    row.Id,
                    row.Title,
                    row.Kind,
                    row.TotalCents,
                    row.ShareCents,
                    row.CategoryId,
                    row.AccountId,
                    row.StartDate,
                    row.Note,
                    row.Frequency,
                    row.NextDate,
                    row.AnchorDay,
                    row.Active
                ))
                .ToListAsync(cancellationToken),
            await context
                .LedgerEntries.AsNoTracking()
                .Where(row => row.UserId == userId)
                .OrderByDescending(row => row.EntryDate)
                .ThenBy(row => row.Id)
                .Select(row => new StoredEntry(
                    row.Id,
                    row.Title,
                    row.Kind,
                    row.TotalCents,
                    row.ShareCents,
                    row.CategoryId,
                    row.AccountId,
                    row.TripId,
                    row.EntryDate,
                    row.Note,
                    row.ReceiptId,
                    row.RecurringId
                ))
                .ToListAsync(cancellationToken)
        );
    }

    public async Task<bool> TrySaveAsync(
        string userId,
        long expectedRevision,
        StoredLedger ledger,
        Action<LedgerWriteState> verify,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        // READ COMMITTED. Disposing without commit rolls back (verify failures,
        // cancellation and errors alike).
        await using var transaction = await context.Database.BeginTransactionAsync(
            cancellationToken
        );
        // Compare-and-increment. The row lock serializes concurrent savers; a loser
        // re-evaluates the predicate after the winner commits and updates nothing.
        var updated = await context
            .Ledgers.Where(row => row.UserId == userId && row.Revision == expectedRevision)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(row => row.Revision, row => row.Revision + 1)
                        .SetProperty(row => row.Currency, ledger.Currency),
                cancellationToken
            );
        // Checks run even for a stale revision so their errors take precedence over
        // the conflict, as in the legacy service. When the revision matched, the
        // ledger row is locked, so these reads see every write committed before it.
        verify(await ReadWriteStateAsync(context, userId, ledger, cancellationToken));
        if (updated != 1)
            return false;
        await SyncAsync(
            context.LedgerAccounts,
            userId,
            ledger.Accounts.Select(account => new LedgerAccount
            {
                UserId = userId,
                Id = account.Id,
                Name = account.Name,
                Type = account.Type,
            }),
            row => row.Id,
            cancellationToken
        );
        await SyncAsync(
            context.LedgerCategories,
            userId,
            ledger.Categories.Select(category => new LedgerCategory
            {
                UserId = userId,
                Id = category.Id,
                Name = category.Name,
                Icon = category.Icon,
                Color = category.Color,
                Kind = category.Kind,
            }),
            row => row.Id,
            cancellationToken
        );
        await SyncAsync(
            context.LedgerTrips,
            userId,
            ledger.Trips.Select(trip => new LedgerTrip
            {
                UserId = userId,
                Id = trip.Id,
                Name = trip.Name,
                StartDate = trip.StartDate,
                EndDate = trip.EndDate,
                SharedHouseholdId = trip.SharedHouseholdId,
            }),
            row => row.Id,
            cancellationToken
        );
        await SyncAsync(
            context.LedgerRecurring,
            userId,
            ledger.Recurring.Select(rule => new LedgerRecurring
            {
                UserId = userId,
                Id = rule.Id,
                Title = rule.Title,
                Kind = rule.Kind,
                TotalCents = rule.TotalCents,
                ShareCents = rule.ShareCents,
                CategoryId = rule.CategoryId,
                AccountId = rule.AccountId,
                StartDate = rule.StartDate,
                Note = rule.Note,
                Frequency = rule.Frequency,
                NextDate = rule.NextDate,
                AnchorDay = rule.AnchorDay,
                Active = rule.Active,
            }),
            row => row.Id,
            cancellationToken
        );
        // New entries and their search documents skip the change tracker and are copied
        // in bulk after the save (MAZ-137); updates and deletes stay with EF.
        var newEntries = new List<LedgerEntry>();
        var newDocuments = new List<SearchDocument>();
        await SyncAsync(
            context.LedgerEntries,
            userId,
            ledger.Entries.Select(entry => new LedgerEntry
            {
                UserId = userId,
                Id = entry.Id,
                Title = entry.Title,
                Kind = entry.Kind,
                TotalCents = entry.TotalCents,
                ShareCents = entry.ShareCents,
                CategoryId = entry.CategoryId,
                AccountId = entry.AccountId,
                TripId = entry.TripId,
                EntryDate = entry.Date,
                Note = entry.Note,
                ReceiptId = entry.ReceiptId,
                RecurringId = entry.RecurringId,
            }),
            row => row.Id,
            cancellationToken,
            newEntries
        );
        // Search (MAZ-121): personal documents follow the entries, categories and
        // accounts in this transaction, so search never diverges from the committed
        // revision; a category or account rename rewrites every affected document.
        var links = new ReceiptLinks();
        await SearchIndexer.StageLedgerAsync(
            context,
            userId,
            ledger,
            newDocuments,
            links,
            cancellationToken
        );
        // EF orders the inserts, updates and deletes so foreign keys hold. The copied
        // rows come after: the categories, accounts, trips and receipts they reference
        // exist by then, and nothing EF deletes can reference a new entry.
        await context.SaveChangesAsync(cancellationToken);
        await BulkInsert.CopyAsync(context, newEntries, cancellationToken);
        await BulkInsert.CopyAsync(context, newDocuments, cancellationToken);
        // Receipt text (MAZ-125): a replaced or removed receipt loses its text and
        // chunks, a newly linked one without text is queued, in this transaction.
        await ReceiptTextIndex.ApplyAsync(context, links, cancellationToken);
        // The payer sees their account name in their own shared expenses' documents.
        await SearchIndexer.SyncPaidExpensesAsync(context, userId, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    private static async Task<LedgerWriteState> ReadWriteStateAsync(
        PennyDbContext context,
        string userId,
        StoredLedger ledger,
        CancellationToken cancellationToken
    )
    {
        var receiptIds = ledger
            .Entries.Select(entry => entry.ReceiptId)
            .OfType<string>()
            .Distinct(StringComparer.Ordinal)
            .ToList();
        var householdIds = ledger
            .Trips.Select(trip => trip.SharedHouseholdId)
            .OfType<string>()
            .Distinct(StringComparer.Ordinal)
            .ToList();
        // Active memberships of non-archived households, as the legacy query.
        var currencies = await context
            .HouseholdMemberPeriods.Where(member =>
                member.UserId == userId && member.LeftAt == null
            )
            .Join(
                context.Households.Where(household => household.ArchivedAt == null),
                member => member.HouseholdId,
                household => household.Id,
                (_, household) => household.Currency
            )
            .Distinct()
            .ToListAsync(cancellationToken);
        // Household expenses and rules this user paid from a personal account.
        var linkedAccounts = await context
            .HouseholdExpenses.Where(expense =>
                expense.PayerId == userId && expense.AccountId != null && expense.DeletedAt == null
            )
            .Select(expense => expense.AccountId!)
            .Union(
                context
                    .HouseholdRecurring.Where(rule =>
                        rule.PayerId == userId && rule.AccountId != null
                    )
                    .Select(rule => rule.AccountId!)
            )
            .ToListAsync(cancellationToken);
        return new(
            await context.LedgerAccounts.AnyAsync(row => row.UserId == userId, cancellationToken),
            await context.LedgerTrips.AnyAsync(row => row.UserId == userId, cancellationToken),
            currencies.ToHashSet(StringComparer.Ordinal),
            linkedAccounts.ToHashSet(StringComparer.Ordinal),
            receiptIds.Count == 0
                ? new HashSet<string>(StringComparer.Ordinal)
                : (
                    await context
                        .Receipts.Where(row => row.UserId == userId && receiptIds.Contains(row.Id))
                        .Select(row => row.Id)
                        .ToListAsync(cancellationToken)
                ).ToHashSet(StringComparer.Ordinal),
            householdIds.Count == 0
                ? new HashSet<string>(StringComparer.Ordinal)
                : (
                    await context
                        .Households.Where(row => householdIds.Contains(row.Id))
                        .Select(row => row.Id)
                        .ToListAsync(cancellationToken)
                ).ToHashSet(StringComparer.Ordinal)
        );
    }

    // Keyed diff of one child table: delete missing rows, update changed, insert new.
    // With `inserts`, new rows are collected there for a bulk copy instead of tracked.
    private static async Task SyncAsync<T>(
        DbSet<T> table,
        string userId,
        IEnumerable<T> desired,
        Func<T, string> key,
        CancellationToken cancellationToken,
        List<T>? inserts = null
    )
        where T : class
    {
        var existing = (
            await table
                .Where(row => EF.Property<string>(row, "UserId") == userId)
                .ToListAsync(cancellationToken)
        ).ToDictionary(key, StringComparer.Ordinal);
        foreach (var row in desired)
            if (existing.Remove(key(row), out var current))
                table.Entry(current).CurrentValues.SetValues(row);
            else if (inserts is not null)
                inserts.Add(row);
            else
                table.Add(row);
        table.RemoveRange(existing.Values);
    }
}
