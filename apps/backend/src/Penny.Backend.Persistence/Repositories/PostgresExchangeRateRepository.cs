using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Repositories;

// The cached ECB reference rates (MAZ-151). Writes are idempotent upserts keyed by
// publication date and currency, so every API process may refresh: when two insert the
// same new quotes at once, the second fails its unique key, rolls back and changes
// nothing (the first stored them).
public sealed class PostgresExchangeRateRepository(NpgsqlDataSource source)
    : IExchangeRateRepository
{
    public async Task<DateOnly?> LatestDateAsync(CancellationToken cancellationToken)
    {
        await using var context = PennyDbContext.Create(source);
        return await context
            .ExchangeRates.AsNoTracking()
            .MaxAsync(rate => (DateOnly?)rate.RateDate, cancellationToken);
    }

    public async Task<DateOnly?> LatestOnOrBeforeAsync(
        DateOnly date,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        return await context
            .ExchangeRates.AsNoTracking()
            .Where(rate => rate.RateDate <= date)
            .MaxAsync(rate => (DateOnly?)rate.RateDate, cancellationToken);
    }

    public async Task<IReadOnlyList<StoredRate>> ReadAsync(
        DateOnly date,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        return await context
            .ExchangeRates.AsNoTracking()
            .Where(rate => rate.RateDate == date)
            .OrderBy(rate => rate.Currency)
            .Select(rate => new StoredRate(rate.RateDate, rate.Currency, rate.PerEuro))
            .ToListAsync(cancellationToken);
    }

    public async Task<int> UpsertAsync(
        IReadOnlyList<StoredRate> rates,
        CancellationToken cancellationToken
    )
    {
        if (rates.Count == 0)
            return 0;
        // The last quote for a date and currency wins.
        var desired = new Dictionary<(DateOnly, string), string>();
        foreach (var rate in rates)
            desired[(rate.Date, rate.Currency)] = rate.PerEuro;
        var from = desired.Keys.Min(key => key.Item1);
        await using var context = PennyDbContext.Create(source);
        await using var transaction = await context.Database.BeginTransactionAsync(
            cancellationToken
        );
        var existing = (
            await context
                .ExchangeRates.Where(rate => rate.RateDate >= from)
                .ToListAsync(cancellationToken)
        ).ToDictionary(rate => (rate.RateDate, rate.Currency));
        var inserts = new List<ExchangeRate>();
        var changed = 0;
        foreach (var ((date, currency), perEuro) in desired)
        {
            if (existing.TryGetValue((date, currency), out var row))
            {
                if (row.PerEuro == perEuro)
                    continue;
                row.PerEuro = perEuro;
            }
            else
                inserts.Add(
                    new ExchangeRate
                    {
                        RateDate = date,
                        Currency = currency,
                        PerEuro = perEuro,
                    }
                );
            changed++;
        }
        if (changed == 0)
            return 0;
        try
        {
            await context.SaveChangesAsync(cancellationToken);
            // The first fetch stores the whole history (about 200,000 quotes) in one COPY.
            await BulkInsert.CopyAsync(context, inserts, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (PostgresException error) when (error.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return 0;
        }
        return changed;
    }
}
