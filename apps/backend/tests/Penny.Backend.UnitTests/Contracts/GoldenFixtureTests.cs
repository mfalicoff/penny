using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Penny.Backend.Domain.Households;
using Penny.Backend.Domain.Ledgers;
using Penny.Backend.UnitTests.Ledgers;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Contracts;

// MAZ-62 golden fixtures generated from the TypeScript reference rules
// (scripts/fixtures/generate-golden.ts), decoded into strict models and checked
// against the .NET domain.
public sealed class GoldenFixtureTests
{
    [Fact]
    public void whenLedgerAmountsRead_LedgerReader_ShouldAcceptExactlyTheTypeScriptBounds()
    {
        var golden = StrictJson.Read<MoneyFixture>("money.json");
        golden.Parse.All(item => item.Cents.HasValue != (item.Error is not null)).ShouldBeTrue();
        golden
            .PersonalShares.All(item => item.Share.HasValue != (item.Error is not null))
            .ShouldBeTrue();
        foreach (var item in golden.LedgerAmounts)
        {
            var body = JsonSerializer.SerializeToElement(
                new
                {
                    revision = 0,
                    ledger = new
                    {
                        version = 4,
                        currency = "CAD",
                        accounts = Array.Empty<object>(),
                        trips = Array.Empty<object>(),
                        recurring = Array.Empty<object>(),
                        categories = new[]
                        {
                            new
                            {
                                id = "food",
                                name = "Food",
                                icon = "cafe-outline",
                                color = "#E47850",
                                kind = "expense",
                            },
                        },
                        transactions = new[]
                        {
                            new
                            {
                                id = "t",
                                title = "Sample",
                                kind = "expense",
                                total = item.Total,
                                share = item.Share,
                                categoryId = "food",
                                date = "2026-10-01",
                                note = "",
                            },
                        },
                    },
                }
            );
            (LedgerReader.Read(body) is not null).ShouldBe(
                item.Valid,
                string.Create(
                    CultureInfo.InvariantCulture,
                    $"total {item.Total}, share {item.Share}"
                )
            );
        }
        // The largest parsed client amount is the server's cent ceiling.
        golden.Parse.Max(item => item.Cents ?? 0).ShouldBe(LedgerLimits.MaxCents);
    }

    [Fact]
    public void whenRecurrenceCasesRead_RecurringDates_ShouldMatchTypeScriptOccurrences()
    {
        var golden = StrictJson.Read<RecurrenceFixture>("recurrence.json");
        foreach (var item in golden.Next)
            RecurringDates
                .Next(item.Date, item.Frequency, item.AnchorDay)
                .ShouldBe(item.Next, $"{item.Date} {item.Frequency} anchor {item.AnchorDay}");
        foreach (var sequence in golden.Sequences)
        {
            sequence.Dates[0].ShouldBe(sequence.Start);
            for (var index = 1; index < sequence.Dates.Count; index++)
                RecurringDates
                    .Next(sequence.Dates[index - 1], sequence.Frequency, sequence.AnchorDay)
                    .ShouldBe(sequence.Dates[index]);
        }
    }

    [Fact]
    public void whenManifestRead_Fixtures_ShouldMatchTheirPublishedHashes()
    {
        var manifest = StrictJson.Read<FixtureManifest>("manifest.json");
        manifest.Fixtures.Count.ShouldBeGreaterThan(10);
        foreach (var entry in manifest.Fixtures)
        {
            var text = ContractFixtures
                .Text(entry.File)
                .Replace("\r\n", "\n", StringComparison.Ordinal);
            Convert
                .ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text)))
                .ShouldBe(entry.Sha256, $"{entry.File} changed without regenerating the manifest");
            entry
                .Consumers.Keys.Order(StringComparer.Ordinal)
                .ShouldBe(["csharp", "swift", "typescript"]);
        }
    }

    [Fact]
    public void whenFixtureHasUnknownMember_StrictJson_ShouldRejectIt()
    {
        Should.Throw<JsonException>(() =>
            JsonSerializer.Deserialize<RecurrenceCase>(
                """{"date":"2026-01-31","frequency":"monthly","anchorDay":31,"next":"2026-02-28","extra":1}""",
                StrictJson.Options
            )
        );
        Should.Throw<JsonException>(() =>
            JsonSerializer.Deserialize<RecurrenceCase>(
                """{"date":"2026-01-31","frequency":"monthly","next":"2026-02-28"}""",
                StrictJson.Options
            )
        );
    }
}
