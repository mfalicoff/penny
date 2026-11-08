using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

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
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
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
            cancellationToken
        );
        // EF orders the inserts, updates and deletes so foreign keys hold.
        await context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    // Keyed diff of one child table: delete missing rows, update changed, insert new.
    private static async Task SyncAsync<T>(
        DbSet<T> table,
        string userId,
        IEnumerable<T> desired,
        Func<T, string> key,
        CancellationToken cancellationToken
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
            else
                table.Add(row);
        table.RemoveRange(existing.Values);
    }
}
