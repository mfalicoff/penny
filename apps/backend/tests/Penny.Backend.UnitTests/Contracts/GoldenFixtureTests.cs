using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Penny.Backend.Domain.Households;
using Penny.Backend.Domain.Ledgers;
using Penny.Backend.UnitTests.Ledgers;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Contracts;

// MAZ-62 golden fixtures generated from the TypeScript reference rules
// (apps/web/scripts/fixtures/generate-golden.ts), decoded into strict models and checked
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

    // Built like `money()` in generate-golden.ts: one entry or rule of the case's kind.
    [Fact]
    public void whenLedgerParticipantsRead_LedgerReader_ShouldAcceptExactlyTheTypeScriptRule()
    {
        var golden = StrictJson.Read<MoneyFixture>("money.json");
        golden.LedgerParticipants.ShouldNotBeEmpty();
        foreach (var item in golden.LedgerParticipants)
        {
            var entry = new JsonObject
            {
                ["id"] = "t",
                ["title"] = "Sample",
                ["kind"] = item.Kind,
                ["total"] = 1000,
                ["share"] = item.Kind == "expense" ? 500 : 1000,
                ["categoryId"] = "c",
                ["date"] = "2026-10-01",
                ["note"] = "",
            };
            if (item.Participants is { } participants)
                entry["participants"] = participants;
            var transactions = new JsonArray();
            var recurring = new JsonArray();
            if (item.List == "transaction")
            {
                transactions.Add(entry);
            }
            else
            {
                item.List.ShouldBe("recurring");
                entry["frequency"] = "monthly";
                entry["nextDate"] = "2026-11-01";
                entry["anchorDay"] = 1;
                entry["active"] = true;
                recurring.Add(entry);
            }
            var body = new JsonObject
            {
                ["revision"] = 0,
                ["ledger"] = new JsonObject
                {
                    ["version"] = 4,
                    ["currency"] = "CAD",
                    ["accounts"] = new JsonArray(),
                    ["trips"] = new JsonArray(),
                    ["categories"] = new JsonArray(
                        new JsonObject
                        {
                            ["id"] = "c",
                            ["name"] = "Category",
                            ["icon"] = "cafe-outline",
                            ["color"] = "#E47850",
                            ["kind"] = item.Kind,
                        }
                    ),
                    ["transactions"] = transactions,
                    ["recurring"] = recurring,
                },
            };
            using var document = JsonDocument.Parse(body.ToJsonString());
            (LedgerReader.Read(document.RootElement) is not null).ShouldBe(
                item.Valid,
                string.Create(
                    CultureInfo.InvariantCulture,
                    $"{item.Kind} {item.List}, participants {item.Participants?.ToString(CultureInfo.InvariantCulture) ?? "absent"}"
                )
            );
        }
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

    // Contract 2.3.0. Detection runs on the devices only, so the server decodes the fixture
    // strictly and accepts every case ledger, `dismissedSuggestions` kept in order.
    [Fact]
    public void whenRecurringSuggestionsRead_LedgerReader_ShouldAcceptEveryCaseLedger()
    {
        var golden = StrictJson.Read<RecurringSuggestionsFixture>("recurring-suggestions.json");
        golden.Keys.ShouldNotBeEmpty();
        golden.Cases.ShouldNotBeEmpty();
        var dismissing = 0;
        foreach (var item in golden.Cases)
        {
            var body = new JsonObject
            {
                ["revision"] = 0,
                ["ledger"] = JsonNode.Parse(item.Ledger.GetRawText()),
            };
            using var document = JsonDocument.Parse(body.ToJsonString());
            var write = LedgerReader.Read(document.RootElement);
            write.ShouldNotBeNull(item.Name);
            var sent = item.Ledger.TryGetProperty("dismissedSuggestions", out var dismissed)
                ? dismissed.EnumerateArray().Select(value => value.GetString()!).ToList()
                : [];
            write.Ledger.DismissedSuggestions.ShouldBe(sent, item.Name);
            if (sent.Count > 0)
                dismissing++;
            var entryIds = write
                .Ledger.Transactions.Select(entry => entry.Id)
                .ToHashSet(StringComparer.Ordinal);
            foreach (var suggestion in item.Expected)
            {
                suggestion.Id.ShouldBe(
                    $"{suggestion.Kind}|{suggestion.Key}|{suggestion.Frequency}",
                    item.Name
                );
                suggestion.EntryIds.Count.ShouldBe(suggestion.Count, item.Name);
                suggestion.EntryIds.All(entryIds.Contains).ShouldBeTrue(item.Name);
            }
        }
        dismissing.ShouldBeGreaterThan(0);
        StrictJson
            .Read<FixtureManifest>("manifest.json")
            .Fixtures.Single(entry => entry.File == "recurring-suggestions.json")
            .Consumers["csharp"]
            .EnumerateArray()
            .Select(path => path.GetString())
            .ShouldContain(
                "apps/backend/tests/Penny.Backend.UnitTests/Contracts/GoldenFixtureTests.cs"
            );
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
