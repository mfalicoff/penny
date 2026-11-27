using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Penny.Backend.Application.Rates;
using Penny.Backend.Domain.Errors;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// GET /api/rates (MAZ-151) over real HTTP and PostgreSQL, from a seeded cache of synthetic
// per-euro quotes: Friday 2026-11-06 and Monday 2026-11-09. The expected cross rates come
// from the TypeScript `crossRate`.
public sealed class RatesTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    private async Task SeedAsync()
    {
        await using var context = PennyDbContext.Create(Fixture.Admin);
        foreach (
            var (date, currency, perEuro) in new[]
            {
                (new DateOnly(2026, 11, 6), "USD", "1.08"),
                (new DateOnly(2026, 11, 6), "JPY", "160.5"),
                (new DateOnly(2026, 11, 6), "CAD", "1.46"),
                (new DateOnly(2026, 11, 9), "USD", "1.0825"),
                (new DateOnly(2026, 11, 9), "JPY", "162.1"),
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

    private async Task<JsonElement> GetAsync(string token, string query, HttpClient? client = null)
    {
        using var request = Authorized(HttpMethod.Get, "/api/rates" + query, bearer: token);
        using var response = await (client ?? Client).SendAsync(request, Ct);
        var text = await response.Content.ReadAsStringAsync(Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, text);
        response.Headers.CacheControl!.Private.ShouldBeTrue();
        response.Headers.CacheControl.MaxAge.ShouldBe(TimeSpan.FromHours(1));
        response.Headers.CacheControl.NoStore.ShouldBeFalse();
        return JsonDocument.Parse(text).RootElement.Clone();
    }

    private static Dictionary<string, string> Rates(JsonElement answer) =>
        answer
            .GetProperty("rates")
            .EnumerateObject()
            .ToDictionary(rate => rate.Name, rate => rate.Value.GetString()!);

    [Fact]
    public async Task whenDateIsAWeekend_GetRates_ShouldUseThePreviousBusinessDay()
    {
        await SeedAsync();
        var token = await RegisterAsync("rates@example.test");
        var answer = await GetAsync(token, "?base=CAD&date=2026-11-08");
        answer.GetProperty("enabled").GetBoolean().ShouldBeTrue();
        answer.GetProperty("source").GetString().ShouldBe("European Central Bank");
        answer.GetProperty("base").GetString().ShouldBe("CAD");
        answer.GetProperty("date").GetString().ShouldBe("2026-11-08");
        answer.GetProperty("rateDate").GetString().ShouldBe("2026-11-06");
        answer.GetProperty("provisional").GetBoolean().ShouldBeFalse();
        answer.GetProperty("latestDate").GetString().ShouldBe("2026-11-09");
        Rates(answer)
            .ShouldBe(
                new Dictionary<string, string>
                {
                    ["EUR"] = "1.46",
                    ["JPY"] = "0.00909657",
                    ["USD"] = "1.35185",
                }
            );
        // A publication day uses its own rates; the euro is a base like any other.
        var euro = await GetAsync(token, "?base=EUR&date=2026-11-09");
        euro.GetProperty("rateDate").GetString().ShouldBe("2026-11-09");
        Rates(euro)
            .ShouldBe(
                new Dictionary<string, string>
                {
                    ["CAD"] = "0.682361",
                    ["JPY"] = "0.00616903",
                    ["USD"] = "0.923788",
                }
            );
    }

    [Fact]
    public async Task whenDateIsAfterTheLatestPublication_GetRates_ShouldAnswerTheLatestProvisionally()
    {
        await SeedAsync();
        var token = await RegisterAsync("rates@example.test");
        var answer = await GetAsync(token, "?base=CAD&date=2026-11-10");
        answer.GetProperty("rateDate").GetString().ShouldBe("2026-11-09");
        answer.GetProperty("provisional").GetBoolean().ShouldBeTrue();
        Rates(answer)["EUR"].ShouldBe("1.4655");
        // Without a date: the latest publication itself.
        var latest = await GetAsync(token, "?base=CAD");
        latest.GetProperty("date").GetString().ShouldBe("2026-11-09");
        latest.GetProperty("rateDate").GetString().ShouldBe("2026-11-09");
        latest.GetProperty("provisional").GetBoolean().ShouldBeFalse();
        Rates(latest)
            .ShouldBe(
                new Dictionary<string, string>
                {
                    ["EUR"] = "1.4655",
                    ["JPY"] = "0.00904072",
                    ["USD"] = "1.35381",
                }
            );
    }

    [Fact]
    public async Task whenNothingApplies_GetRates_ShouldAnswerWithoutRates()
    {
        var token = await RegisterAsync("rates@example.test");
        // Nothing fetched yet.
        var empty = await GetAsync(token, "?base=CAD&date=2026-11-08");
        empty.GetProperty("enabled").GetBoolean().ShouldBeTrue();
        empty.GetProperty("rateDate").ValueKind.ShouldBe(JsonValueKind.Null);
        empty.GetProperty("latestDate").ValueKind.ShouldBe(JsonValueKind.Null);
        Rates(empty).ShouldBeEmpty();
        await SeedAsync();
        // Before the first publication.
        var before = await GetAsync(token, "?base=CAD&date=2026-01-02");
        before.GetProperty("rateDate").ValueKind.ShouldBe(JsonValueKind.Null);
        before.GetProperty("provisional").GetBoolean().ShouldBeFalse();
        before.GetProperty("latestDate").GetString().ShouldBe("2026-11-09");
        Rates(before).ShouldBeEmpty();
        // A base the source doesn't quote.
        var unquoted = await GetAsync(token, "?base=XPF&date=2026-11-09");
        unquoted.GetProperty("rateDate").GetString().ShouldBe("2026-11-09");
        Rates(unquoted).ShouldBeEmpty();
    }

    [Theory]
    [InlineData("")]
    [InlineData("?base=cad")]
    [InlineData("?base=XXX")]
    [InlineData("?base=CAD&date=2026-02-30")]
    [InlineData("?base=CAD&date=1999-12-31")]
    [InlineData("?base=CAD&date=2026-1-05")]
    public async Task whenRequestInvalid_GetRates_ShouldRejectIt(string query)
    {
        var token = await RegisterAsync("rates@example.test");
        using var request = Authorized(HttpMethod.Get, "/api/rates" + query, bearer: token);
        using var response = await Client.SendAsync(request, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var error = JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct)).RootElement;
        error.GetProperty("error").GetString().ShouldBe(ExchangeRateService.InvalidRequest);
        error.GetProperty("code").GetString().ShouldBe(ErrorCodes.RatesInvalidRequest);
    }

    [Fact]
    public async Task whenSessionMissing_GetRates_ShouldRequireSignIn()
    {
        using var response = await Client.GetAsync("/api/rates?base=CAD", Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task whenFetchingTurnedOff_GetRates_ShouldAnswerDisabledWithoutRates()
    {
        await SeedAsync();
        await using var disabled = Fixture.Factory.WithWebHostBuilder(builder =>
            builder.UseSetting("ExchangeRates:Enabled", "false")
        );
        using var client = CreateClient(disabled);
        var token = await RegisterAsync("rates@example.test", client);
        var answer = await GetAsync(token, "?base=CAD&date=2026-11-08", client);
        answer.GetProperty("enabled").GetBoolean().ShouldBeFalse();
        answer.GetProperty("source").ValueKind.ShouldBe(JsonValueKind.Null);
        answer.GetProperty("base").GetString().ShouldBe("CAD");
        answer.GetProperty("date").GetString().ShouldBe("2026-11-08");
        answer.GetProperty("rateDate").ValueKind.ShouldBe(JsonValueKind.Null);
        answer.GetProperty("provisional").GetBoolean().ShouldBeFalse();
        answer.GetProperty("latestDate").ValueKind.ShouldBe(JsonValueKind.Null);
        Rates(answer).ShouldBeEmpty();
    }
}
