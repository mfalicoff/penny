using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using Penny.Backend.Application.Households;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Shared trips and households in any currency (MAZ-151 phase 2, contract 2.6.0) over real
// HTTP and PostgreSQL: a euro trip created by a CAD-ledger member and joined by a
// USD-ledger member, expenses paid in US and Canadian dollars, and each member's `home`
// amounts from a seeded cache of synthetic per-euro quotes (Friday 2026-11-06 and Monday
// 2026-11-09). The expected amounts come from the TypeScript `crossRate`,
// `convertAmount` and `memberAmounts`.
public sealed class SharedCurrencyTests(ApiFixture fixture) : SharedRecurrenceTestBase(fixture)
{
    private async Task SeedRatesAsync()
    {
        await using var context = PennyDbContext.Create(Fixture.Admin);
        foreach (
            var (date, currency, perEuro) in new[]
            {
                (new DateOnly(2026, 11, 6), "USD", "1.08"),
                (new DateOnly(2026, 11, 6), "CAD", "1.46"),
                (new DateOnly(2026, 11, 9), "USD", "1.0825"),
                (new DateOnly(2026, 11, 9), "CAD", "1.4655"),
            }
        )
            context.ExchangeRates.Add(
                new ExchangeRate
                {
                    RateDate = date,
                    Currency = currency,
                    PerEuro = perEuro,
                }
            );
        await context.SaveChangesAsync(Ct);
    }

    // Alex (CAD ledger) creates a euro trip; Bea (USD ledger) joins it.
    private async Task<(
        string Alex,
        string AlexId,
        string Bea,
        string BeaId,
        string Trip
    )> EuroTripAsync()
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        var ledger = await GetLedgerAsync(bea);
        ledger["ledger"]!["currency"] = "USD";
        using (var saved = await PutLedgerAsync(bea, ledger))
            saved.StatusCode.ShouldBe(HttpStatusCode.OK);
        var trip = (
            await ExpectAsync(
                HttpMethod.Post,
                "/api/households/trips",
                alex,
                HttpStatusCode.Created,
                new
                {
                    name = "Lisbon",
                    currency = "EUR",
                    startDate = "2026-11-05",
                    endDate = "2026-11-12",
                }
            )
        ).GetProperty("household");
        trip.GetProperty("currency").GetString().ShouldBe("EUR");
        var tripId = Id(trip);
        await AdmitAsync(tripId, alex, bea);
        return (alex, alexId, bea, beaId, tripId);
    }

    // 60.00 USD on Friday at the published 0.925926 EUR per USD, paid by Alex.
    private static Dictionary<string, object?> Dinner(string payerId, long totalCents = 5556) =>
        Expense(
            totalCents,
            payerId,
            "2026-11-06",
            new
            {
                title = "Dinner",
                originalAmount = 6000,
                originalCurrency = "USD",
                rate = "0.925926",
                rateStatus = "published",
                rateDate = "2026-11-06",
            }
        );

    // 100.00 CAD on Tuesday, after the latest publication: 0.682361 EUR per CAD,
    // provisionally, paid by Bea.
    private static Dictionary<string, object?> Museum(string payerId) =>
        Expense(
            6824,
            payerId,
            "2026-11-10",
            new
            {
                title = "Museum",
                originalAmount = 10000,
                originalCurrency = "CAD",
                rate = "0.682361",
                rateStatus = "provisional",
                rateDate = "2026-11-09",
            }
        );

    private static JsonElement Find(IEnumerable<JsonElement> rows, string title) =>
        rows.Single(row => row.GetProperty("title").GetString() == title);

    private static void ShouldBeHome(
        JsonElement row,
        string currency,
        long total,
        long share,
        string? rate = null,
        string? status = null,
        string? rateDate = null
    )
    {
        var home = row.GetProperty("home");
        home.GetProperty("currency").GetString().ShouldBe(currency);
        home.GetProperty("totalCents").GetInt64().ShouldBe(total);
        home.GetProperty("shareCents").GetInt64().ShouldBe(share);
        (home.TryGetProperty("rate", out var r) ? r.GetString() : null).ShouldBe(rate);
        (home.TryGetProperty("rateStatus", out var s) ? s.GetString() : null).ShouldBe(status);
        (home.TryGetProperty("rateDate", out var d) ? d.GetString() : null).ShouldBe(rateDate);
    }

    [Fact]
    public async Task whenMembersKeepOtherCurrencies_SharedTrip_ShouldShowEachMemberTheirHomeAmounts()
    {
        await SeedRatesAsync();
        var (alex, alexId, bea, beaId, trip) = await EuroTripAsync();

        // Each member's home currency is listed with the members.
        (await MemberAsync(trip, bea, alexId)).GetProperty("currency").GetString().ShouldBe("CAD");
        (await MemberAsync(trip, alex, beaId)).GetProperty("currency").GetString().ShouldBe("USD");

        var dinner = await CreateExpenseAsync(trip, alex, Dinner(alexId));
        dinner.GetProperty("totalCents").GetInt64().ShouldBe(5556);
        Amounts(dinner).ShouldBe([2778L, 2778L]);
        dinner.GetProperty("originalAmount").GetInt64().ShouldBe(6000);
        dinner.GetProperty("originalCurrency").GetString().ShouldBe("USD");
        dinner.GetProperty("rate").GetString().ShouldBe("0.925926");
        dinner.GetProperty("rateStatus").GetString().ShouldBe("published");
        dinner.GetProperty("rateDate").GetString().ShouldBe("2026-11-06");
        // The creator sees it in Canadian dollars at Friday's 1.35185 CAD per USD.
        ShouldBeHome(dinner, "CAD", 8111, 4056, "1.35185", "published", "2026-11-06");
        var museum = await CreateExpenseAsync(trip, bea, Museum(beaId));
        Amounts(museum).ShouldBe([3412L, 3412L]);
        // After the latest publication, the latest rate, provisionally.
        ShouldBeHome(museum, "USD", 7387, 3694, "0.738656", "provisional", "2026-11-09");

        // The expense list: each viewer in their own currency; exact (no rate) when it was
        // paid in it.
        var alexList = await ListExpensesAsync(trip, alex);
        ShouldBeHome(
            Find(alexList, "Dinner"),
            "CAD",
            8111,
            4056,
            "1.35185",
            "published",
            "2026-11-06"
        );
        ShouldBeHome(Find(alexList, "Museum"), "CAD", 10000, 5000);
        var beaList = await ListExpensesAsync(trip, bea);
        ShouldBeHome(Find(beaList, "Dinner"), "USD", 6000, 3000);
        ShouldBeHome(
            Find(beaList, "Museum"),
            "USD",
            7387,
            3694,
            "0.738656",
            "provisional",
            "2026-11-09"
        );
        ShouldBeHome(await GetExpenseAsync(trip, Id(dinner), bea), "USD", 6000, 3000);

        // The projection carries what was paid and the home amounts.
        var alexRows = (await ProjectionAsync(alex, "?month=2026-11"))
            .GetProperty("transactions")
            .EnumerateArray()
            .ToList();
        alexRows.Count.ShouldBe(2);
        var alexDinner = Find(alexRows, "Dinner");
        alexDinner.GetProperty("householdCurrency").GetString().ShouldBe("EUR");
        alexDinner.GetProperty("shareCents").GetInt64().ShouldBe(2778);
        alexDinner.GetProperty("originalCurrency").GetString().ShouldBe("USD");
        alexDinner.GetProperty("rate").GetString().ShouldBe("0.925926");
        ShouldBeHome(alexDinner, "CAD", 8111, 4056, "1.35185", "published", "2026-11-06");
        ShouldBeHome(Find(alexRows, "Museum"), "CAD", 10000, 5000);
        var beaRows = (await ProjectionAsync(bea, "?month=2026-11"))
            .GetProperty("transactions")
            .EnumerateArray()
            .ToList();
        ShouldBeHome(Find(beaRows, "Dinner"), "USD", 6000, 3000);
        ShouldBeHome(
            Find(beaRows, "Museum"),
            "USD",
            7387,
            3694,
            "0.738656",
            "provisional",
            "2026-11-09"
        );

        // The month recap lists its expenses the same way; balances stay in euros.
        var month = await ExpectAsync(
            HttpMethod.Get,
            $"/api/households/{trip}/months/2026-11",
            bea,
            HttpStatusCode.OK
        );
        ShouldBeHome(
            Find(month.GetProperty("expenses").EnumerateArray(), "Dinner"),
            "USD",
            6000,
            3000
        );

        // The audit keeps what was paid, never a viewer's home amounts.
        (
            await ScalarAsync(
                $"SELECT concat_ws(',', after_json->>'originalAmount', after_json->>'originalCurrency', after_json->>'rate', (after_json ? 'home')::text) FROM penny.household_audit WHERE expense_id = '{Id(dinner)}' AND action = 'expense.created'"
            )
        ).ShouldBe("6000,USD,0.925926,false");

        // An edit keeps the foreign fields it sends and drops those it doesn't.
        var edited = await UpdateExpenseAsync(
            trip,
            Id(dinner),
            alex,
            WithRevision(Expense(5000, alexId, "2026-11-06", new { title = "Dinner" }), 0)
        );
        edited.TryGetProperty("originalAmount", out _).ShouldBeFalse();
        ShouldBeHome(edited, "CAD", 7300, 3650, "1.46", "published", "2026-11-06");
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_expenses WHERE id = '{Id(dinner)}' AND original_amount IS NULL AND rate IS NULL"
            )
        ).ShouldBe(1L);
    }

    [Fact]
    public async Task whenHouseholdUsesTheViewersCurrency_SharedExpense_ShouldOmitHome()
    {
        await SeedRatesAsync();
        var (alex, alexId) = await AccountAsync("alex@example.test");
        At(Noon);
        var home = Id(await CreateHouseholdAsync(alex));
        var expense = await CreateExpenseAsync(home, alex, Expense(1000, alexId));
        expense.TryGetProperty("home", out _).ShouldBeFalse();
        var paidInEuros = await CreateExpenseAsync(
            home,
            alex,
            Expense(
                1466,
                alexId,
                "2026-09-28",
                new
                {
                    originalAmount = 1000,
                    originalCurrency = "EUR",
                    rate = "1.4655",
                    rateStatus = "published",
                    rateDate = "2026-11-09",
                }
            )
        );
        paidInEuros.GetProperty("originalCurrency").GetString().ShouldBe("EUR");
        paidInEuros.TryGetProperty("home", out _).ShouldBeFalse();
    }

    [Fact]
    public async Task whenNoRateIsCached_SharedExpense_ShouldOmitHomeUnlessPaidInTheHomeCurrency()
    {
        var (alex, alexId, bea, _, trip) = await EuroTripAsync();
        var dinner = await CreateExpenseAsync(trip, alex, Dinner(alexId));
        dinner.TryGetProperty("home", out _).ShouldBeFalse();
        ShouldBeHome(await GetExpenseAsync(trip, Id(dinner), bea), "USD", 6000, 3000);
        var euros = await CreateExpenseAsync(trip, alex, Expense(1200, alexId, "2026-11-06"));
        euros.TryGetProperty("home", out _).ShouldBeFalse();
    }

    [Fact]
    public async Task whenForeignFieldsAreInvalid_CreateExpense_ShouldRefuseThem()
    {
        await SeedRatesAsync();
        var (alex, alexId, _, _, trip) = await EuroTripAsync();
        var invalid = new[]
        {
            // The total isn't the conversion of what was paid.
            Dinner(alexId, totalCents: 5557),
            // Paid in the trip's own currency.
            Expense(
                6000,
                alexId,
                "2026-11-06",
                new
                {
                    originalAmount = 6000,
                    originalCurrency = "EUR",
                    rate = "1",
                    rateStatus = "edited",
                }
            ),
            // Part of the set.
            Expense(5556, alexId, "2026-11-06", new { originalAmount = 6000 }),
            // A published rate without its date.
            Expense(
                5556,
                alexId,
                "2026-11-06",
                new
                {
                    originalAmount = 6000,
                    originalCurrency = "USD",
                    rate = "0.925926",
                    rateStatus = "published",
                }
            ),
        };
        foreach (var body in invalid)
            await ExpectErrorAsync(
                HttpMethod.Post,
                ExpensesPath(trip),
                alex,
                HttpStatusCode.BadRequest,
                HouseholdService.InvalidData,
                body
            );
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_expenses WHERE household_id = '{trip}'"
            )
        ).ShouldBe(0L);

        // An edit is checked the same way.
        var dinner = await CreateExpenseAsync(trip, alex, Dinner(alexId));
        await ExpectErrorAsync(
            HttpMethod.Put,
            ExpensePath(trip, Id(dinner)),
            alex,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidData,
            WithRevision(Dinner(alexId, totalCents: 5555), 0)
        );
    }

    [Fact]
    public async Task whenRuleCarriesForeignFields_CreateRule_ShouldRefuseIt()
    {
        var (alex, alexId, _, _, trip) = await EuroTripAsync();
        await ExpectErrorAsync(
            HttpMethod.Post,
            RulesPath(trip),
            alex,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidData,
            Rule(
                5556,
                alexId,
                "2026-12-06",
                extra: new
                {
                    originalAmount = 6000,
                    originalCurrency = "USD",
                    rate = "0.925926",
                    rateStatus = "edited",
                }
            )
        );
        (await CountAsync("SELECT count(*) FROM penny.household_recurring")).ShouldBe(0L);
        // In the trip's currency, a rule is fine.
        await CreateRuleAsync(trip, alex, Rule(5556, alexId, "2026-12-06"));
    }

    [Fact]
    public async Task whenMemberOfAnotherCurrency_PutLedger_ShouldSaveAnyHomeCurrency()
    {
        var (_, _, bea, beaId, trip) = await EuroTripAsync();
        var ledger = await GetLedgerAsync(bea);
        ledger["ledger"]!["currency"] = "GBP";
        using (var saved = await PutLedgerAsync(bea, ledger))
            saved.StatusCode.ShouldBe(HttpStatusCode.OK);
        (
            await ScalarAsync($"SELECT currency FROM penny.ledgers WHERE user_id = '{beaId}'")
        ).ShouldBe("GBP");
        (await DetailAsync(trip, bea))
            .GetProperty("household")
            .GetProperty("currency")
            .GetString()
            .ShouldBe("EUR");

        // A personal trip may name its own currency (contract 2.6.0); it round-trips.
        ledger = await GetLedgerAsync(bea);
        ledger["ledger"]!["trips"] = new JsonArray(
            new JsonObject
            {
                ["id"] = "tokyo",
                ["name"] = "Tokyo",
                ["startDate"] = "2026-12-01",
                ["endDate"] = "2026-12-08",
                ["currency"] = "JPY",
            }
        );
        using (var saved = await PutLedgerAsync(bea, ledger))
            saved.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await GetLedgerAsync(bea))["ledger"]!["trips"]![0]!["currency"]!
            .GetValue<string>()
            .ShouldBe("JPY");
        ledger = await GetLedgerAsync(bea);
        ledger["ledger"]!["trips"]![0]!["currency"] = "XXX";
        using (var refused = await PutLedgerAsync(bea, ledger))
            refused.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }
}
