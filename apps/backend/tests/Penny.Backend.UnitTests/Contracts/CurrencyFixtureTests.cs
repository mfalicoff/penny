using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Penny.Backend.Domain.Ledgers;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Contracts;

// MAZ-151 golden cases from the TypeScript reference rules (apps/web/src/domain/currency.ts
// and apps/web/src/validation/ledger.ts), checked against the .NET Currencies rules and
// the real LedgerReader. The manifest hash check in GoldenFixtureTests covers this file.
public sealed class CurrencyFixtureTests
{
    private static readonly CurrencyFixture Golden = StrictJson.Read<CurrencyFixture>(
        "currency.json"
    );

    [Fact]
    public void whenCurrenciesRead_CurrencyList_ShouldMatchTheTypeScriptList()
    {
        Currencies
            .All.Select(currency => (currency.Code, currency.Name, currency.MinorUnits))
            .ShouldBe(
                Golden.Currencies.Select(currency =>
                    (currency.Code, currency.Name, currency.MinorUnits)
                )
            );
        Golden.HomeCurrencies.ShouldBe(LedgerLimits.Currencies);
        foreach (var currency in Golden.Currencies)
        {
            Currencies.IsCurrency(currency.Code).ShouldBeTrue(currency.Code);
            Currencies.MinorUnits(currency.Code).ShouldBe(currency.MinorUnits, currency.Code);
        }
    }

    [Fact]
    public void whenConversionsRead_ConvertAmount_ShouldRoundLikeTypeScript()
    {
        Golden.Conversions.ShouldNotBeEmpty();
        foreach (var item in Golden.Conversions)
            Currencies
                .ConvertAmount(item.Amount, item.From, item.Rate, item.Home)
                .ShouldBe(
                    item.Converted,
                    string.Create(
                        CultureInfo.InvariantCulture,
                        $"{item.Amount} {item.From} at {item.Rate} in {item.Home}"
                    )
                );
    }

    [Fact]
    public void whenCrossRatesRead_CrossRate_ShouldRoundLikeTypeScript()
    {
        Golden.CrossRates.ShouldNotBeEmpty();
        foreach (var item in Golden.CrossRates)
            Currencies
                .CrossRate(item.FromPerBase, item.ToPerBase)
                .ShouldBe(item.Rate, $"{item.FromPerBase} -> {item.ToPerBase}");
    }

    [Fact]
    public void whenRateDatesRead_PublishedRateDate_ShouldPickTheTypeScriptPublication()
    {
        Golden.RateDates.ShouldNotBeEmpty();
        foreach (var item in Golden.RateDates)
        {
            var publication = Currencies.PublishedRateDate(
                item.Published.Select(Day),
                Day(item.Date)
            );
            (
                publication is null
                    ? null
                    : new RateDateResult(
                        LedgerDates.Write(publication.Date),
                        publication.Provisional
                    )
            ).ShouldBe(item.Expected, item.Date);
        }
    }

    [Fact]
    public void whenLedgerCasesRead_LedgerReader_ShouldAcceptExactlyTheTypeScriptSchema()
    {
        Golden.Ledgers.ShouldNotBeEmpty();
        Golden.Ledgers.ShouldContain(item => item.Valid);
        Golden.Ledgers.ShouldContain(item => !item.Valid);
        foreach (var item in Golden.Ledgers)
        {
            var body = new JsonObject
            {
                ["revision"] = 0,
                ["ledger"] = JsonNode.Parse(item.Ledger.GetRawText()),
            };
            using var document = JsonDocument.Parse(body.ToJsonString());
            var write = LedgerReader.Read(document.RootElement);
            (write is not null).ShouldBe(item.Valid, item.Name);
            if (write is null)
                continue;
            // Accepted fields are kept exactly as sent.
            var sent = item.Ledger.GetProperty("transactions");
            for (var index = 0; index < write.Ledger.Transactions.Count; index++)
            {
                var entry = sent[index];
                var foreign = write.Ledger.Transactions[index].Foreign;
                if (!entry.TryGetProperty("originalCurrency", out var currency))
                {
                    foreign.ShouldBeNull(item.Name);
                    continue;
                }
                foreign.ShouldNotBeNull(item.Name);
                foreign.OriginalCurrency.ShouldBe(currency.GetString());
                foreign.OriginalAmount.ShouldBe(entry.GetProperty("originalAmount").GetInt64());
                foreign.Rate.ShouldBe(entry.GetProperty("rate").GetString());
                foreign.RateStatus.ShouldBe(entry.GetProperty("rateStatus").GetString());
                (foreign.RateDate is { } date ? LedgerDates.Write(date) : null).ShouldBe(
                    entry.TryGetProperty("rateDate", out var rateDate) ? rateDate.GetString() : null
                );
            }
        }
    }

    private static DateOnly Day(string value) =>
        LedgerDates.TryParse(value, out var date)
            ? date
            : throw new FormatException("Fixture dates are ledger dates.");
}
