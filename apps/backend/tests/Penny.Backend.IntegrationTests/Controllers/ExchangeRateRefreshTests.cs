using System.Net;
using Microsoft.EntityFrameworkCore;
using Penny.Backend.Application.Rates;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Repositories;
using Penny.Backend.Persistence.Schema;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// The ECB reference rate refresh (MAZ-151) against real PostgreSQL, with a fake rate
// source in place of the ECB: the full history while the cache is empty or stale, the
// 90-day file otherwise, idempotent upserts and failures that change nothing.
public sealed class ExchangeRateRefreshTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    private const string HistoryCsv =
        "Date,USD,JPY,CYP,CAD,\n"
        + "2026-11-06,1.0800,160.5,N/A,1.46,\n"
        + "2026-11-05,1.0812,161.23,N/A,1.4612,\n";

    private readonly FakeRateSource source = new() { HistoryCsv = HistoryCsv };
    private readonly TestClock clock = new();

    private ExchangeRateRefresher Refresher() =>
        new(
            new HttpClient(source),
            new PostgresExchangeRateRepository(Fixture.App),
            new ExchangeRateSettings(true, FakeRateSource.History, FakeRateSource.Recent),
            clock
        );

    private async Task<List<(DateOnly, string, string)>> StoredAsync()
    {
        await using var context = PennyDbContext.Create(Fixture.Admin);
        return
        [
            .. (
                await context
                    .ExchangeRates.OrderBy(rate => rate.RateDate)
                    .ThenBy(rate => rate.Currency)
                    .ToListAsync(Ct)
            ).Select(rate => (rate.RateDate, rate.Currency, rate.PerEuro)),
        ];
    }

    [Fact]
    public async Task whenCacheEmptyThenFresh_RunOnce_ShouldFetchTheHistoryThenTheRecentRates()
    {
        clock.Set(new DateTimeOffset(2026, 11, 7, 12, 0, 0, TimeSpan.Zero));
        (await Refresher().RunOnceAsync(Ct)).ShouldBe(new RateRefresh(true, 6, 6));
        source.Requests.ShouldBe([FakeRateSource.History]);
        (await StoredAsync()).ShouldBe([
            (new DateOnly(2026, 11, 5), "CAD", "1.4612"),
            (new DateOnly(2026, 11, 5), "JPY", "161.23"),
            (new DateOnly(2026, 11, 5), "USD", "1.0812"),
            (new DateOnly(2026, 11, 6), "CAD", "1.46"),
            (new DateOnly(2026, 11, 6), "JPY", "160.5"),
            (new DateOnly(2026, 11, 6), "USD", "1.08"),
        ]);

        // A new publication and a corrected quote; unchanged quotes are left alone.
        clock.Set(new DateTimeOffset(2026, 11, 9, 17, 0, 0, TimeSpan.Zero));
        source.RecentXml = FakeRateSource.Xml(
            ("2026-11-09", [("USD", "1.0825"), ("JPY", "162.10"), ("CAD", "1.4655")]),
            ("2026-11-06", [("USD", "1.0800"), ("JPY", "160.6"), ("CAD", "1.46")])
        );
        (await Refresher().RunOnceAsync(Ct)).ShouldBe(new RateRefresh(false, 6, 4));
        source.Requests[^1].ShouldBe(FakeRateSource.Recent);
        (await StoredAsync()).ShouldBe([
            (new DateOnly(2026, 11, 5), "CAD", "1.4612"),
            (new DateOnly(2026, 11, 5), "JPY", "161.23"),
            (new DateOnly(2026, 11, 5), "USD", "1.0812"),
            (new DateOnly(2026, 11, 6), "CAD", "1.46"),
            (new DateOnly(2026, 11, 6), "JPY", "160.6"),
            (new DateOnly(2026, 11, 6), "USD", "1.08"),
            (new DateOnly(2026, 11, 9), "CAD", "1.4655"),
            (new DateOnly(2026, 11, 9), "JPY", "162.1"),
            (new DateOnly(2026, 11, 9), "USD", "1.0825"),
        ]);
        // The same file again changes nothing.
        (await Refresher().RunOnceAsync(Ct)).ShouldBe(new RateRefresh(false, 6, 0));
    }

    [Fact]
    public async Task whenCacheIsStale_RunOnce_ShouldFetchTheHistoryAgain()
    {
        clock.Set(new DateTimeOffset(2026, 11, 7, 12, 0, 0, TimeSpan.Zero));
        await Refresher().RunOnceAsync(Ct);
        clock.Set(new DateTimeOffset(2027, 2, 1, 12, 0, 0, TimeSpan.Zero));
        (await Refresher().RunOnceAsync(Ct)).History.ShouldBeTrue();
        source.Requests.ShouldBe([FakeRateSource.History, FakeRateSource.History]);
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError, "")]
    [InlineData(HttpStatusCode.OK, "Date,USD\n2026-11-06,N/A\n")]
    public async Task whenSourceFailsOrSendsNothing_RunOnce_ShouldChangeNothing(
        HttpStatusCode status,
        string csv
    )
    {
        clock.Set(new DateTimeOffset(2026, 11, 7, 12, 0, 0, TimeSpan.Zero));
        source.Status = status;
        source.HistoryCsv = csv;
        await Should.ThrowAsync<Exception>(() => Refresher().RunOnceAsync(Ct));
        (await StoredAsync()).ShouldBeEmpty();
    }
}
