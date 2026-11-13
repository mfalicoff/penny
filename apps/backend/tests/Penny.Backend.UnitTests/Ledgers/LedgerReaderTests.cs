using System.Text.Json;
using System.Text.Json.Nodes;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Domain.Ledgers;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Ledgers;

// Ports of the legacy ledgerWriteSchema/upgradeLedger fixtures (tests/core/
// contracts, accounts, trips, investments and model tests).
public sealed class LedgerReaderTests
{
    private const string Valid = """
        {
          "revision": 0,
          "ledger": {
            "version": 4,
            "currency": "CAD",
            "accounts": [{ "id": "visa", "name": "Visa", "type": "credit" }],
            "trips": [{ "id": "montreal", "name": "Montréal", "startDate": "2026-09-10", "endDate": "2026-09-14" }],
            "categories": [
              { "id": "food", "name": "Food", "icon": "cafe-outline", "color": "#E47850", "kind": "expense" },
              { "id": "salary", "name": "Salary", "icon": "briefcase-outline", "color": "#6C9C79", "kind": "income" },
              { "id": "investments", "name": "Investments", "icon": "trending-up-outline", "color": "#678DB1", "kind": "investment" }
            ],
            "transactions": [{
              "id": "dinner", "title": "Dinner", "kind": "expense", "total": 12000, "share": 6000,
              "categoryId": "food", "accountId": "visa", "tripId": "montreal", "date": "2026-09-11", "note": "",
              "receipt": { "id": "receipt-1", "name": "Dinner.pdf", "mime": "application/pdf", "uri": "/api/receipts/receipt-1" }
            }],
            "recurring": [{
              "id": "rent", "title": "Rent", "kind": "expense", "total": 145000, "share": 145000,
              "categoryId": "food", "accountId": "visa", "date": "2026-01-01", "note": "",
              "frequency": "monthly", "nextDate": "2026-02-01", "anchorDay": 1, "active": true
            }]
          }
        }
        """;

    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    [Fact]
    public void whenSanitizedUpgradeFixturesRead_Read_ShouldMatchLegacyUpgradeOutput()
    {
        var cases = ContractFixtures.Read("ledger-upgrades.json").AsArray();
        cases.Select(item => (int)item!["input"]!["version"]!).ShouldBe([1, 2, 3, 4]);
        foreach (var item in cases)
        {
            var write = Read(
                new JsonObject { ["revision"] = 0, ["ledger"] = item!["input"]!.DeepClone() }
            );
            write.ShouldNotBeNull(item["name"]!.GetValue<string>());
            var actual = JsonSerializer.SerializeToNode(LedgerResponse.From(write.Ledger), Web);
            JsonNode
                .DeepEquals(actual, item["expected"])
                .ShouldBeTrue(item["name"]!.GetValue<string>());
        }
    }

    [Fact]
    public void whenValidLedgerRead_Read_ShouldKeepEveryFieldAndOptionalAbsence()
    {
        var write = Read(JsonNode.Parse(Valid)!)!;
        write.Revision.ShouldBe(0);
        write.SourceVersion.ShouldBe(4);
        write.OmittedTrips.ShouldBeFalse();
        var entry = write.Ledger.Transactions.Single();
        entry.Total.ShouldBe(12000);
        entry.Share.ShouldBe(6000);
        entry.Date.ShouldBe(new DateOnly(2026, 9, 11));
        entry.Receipt!.Id.ShouldBe("receipt-1");
        entry.RecurringId.ShouldBeNull();
        write.Ledger.Trips.Single().SharedHouseholdId.ShouldBeNull();
        write.Ledger.Recurring.Single().Active.ShouldBeTrue();
    }

    [Theory]
    [InlineData(1, "investments", "investments-1")]
    [InlineData(1, "food", "investments")]
    [InlineData(2, "investments", null)]
    public void whenLegacyVersionRead_Read_ShouldAddInvestmentCategoryOnlyForVersionOne(
        int version,
        string existingExpenseId,
        string? addedId
    )
    {
        var body = JsonNode.Parse(Valid)!;
        var ledger = body["ledger"]!;
        ledger["version"] = version;
        ledger.AsObject().Remove("trips");
        ledger["transactions"]![0]!.AsObject().Remove("tripId");
        ledger["categories"] = new JsonArray(
            Category(existingExpenseId, "expense"),
            Category("food-2", "expense")
        );
        ledger["transactions"]![0]!["categoryId"] = "food-2";
        ledger["recurring"]![0]!["categoryId"] = "food-2";
        var write = Read(body)!;
        write.SourceVersion.ShouldBe(version);
        write.OmittedTrips.ShouldBeTrue();
        write.Ledger.Trips.ShouldBeEmpty();
        var added = write
            .Ledger.Categories.Where(category => category.Kind == "investment")
            .ToList();
        if (addedId is null)
            added.ShouldBeEmpty();
        else
            added.Single().ShouldBe(LedgerUpgrade.Investments with { Id = addedId });
    }

    [Fact]
    public void whenVersionOneHasInvestmentOrFullCategories_Read_ShouldNotRestoreCategory()
    {
        var body = JsonNode.Parse(Valid)!;
        body["ledger"]!["version"] = 1;
        body["ledger"]!["transactions"]![0]!.AsObject().Remove("tripId");
        body["ledger"]!.AsObject().Remove("trips");
        Read(body)!.Ledger.Categories.Count.ShouldBe(3);
        var categories = new JsonArray(Category("food", "expense"));
        for (var index = 1; index < 300; index++)
            categories.Add(Category("expense-" + index, "expense"));
        body["ledger"]!["categories"] = categories;
        Read(body)!.Ledger.Categories.Count.ShouldBe(300);
    }

    [Theory]
    [InlineData("transaction-account-missing")]
    [InlineData("recurring-account-missing")]
    [InlineData("duplicate-accounts")]
    [InlineData("unknown-account-type")]
    [InlineData("v3-without-accounts")]
    [InlineData("null-accounts")]
    [InlineData("v4-without-trips")]
    [InlineData("trip-ends-before-start")]
    [InlineData("trip-missing")]
    [InlineData("income-on-trip")]
    [InlineData("recurring-on-trip")]
    [InlineData("share-above-total")]
    [InlineData("investment-split")]
    [InlineData("category-kind-mismatch")]
    [InlineData("category-missing")]
    [InlineData("unknown-kind")]
    [InlineData("negative-total")]
    [InlineData("zero-total")]
    [InlineData("fractional-total")]
    [InlineData("string-total")]
    [InlineData("total-above-max")]
    [InlineData("impossible-date")]
    [InlineData("date-before-2000")]
    [InlineData("date-after-2100")]
    [InlineData("short-date")]
    [InlineData("fullwidth-date")]
    [InlineData("null-account-id")]
    [InlineData("null-note")]
    [InlineData("version-5")]
    [InlineData("string-version")]
    [InlineData("unknown-currency")]
    [InlineData("negative-revision")]
    [InlineData("fractional-revision")]
    [InlineData("string-revision")]
    [InlineData("last-safe-revision")]
    [InlineData("unsafe-revision")]
    [InlineData("array-body")]
    [InlineData("null-ledger")]
    [InlineData("invalid-color")]
    [InlineData("color-with-newline")]
    [InlineData("empty-category-name")]
    [InlineData("long-title")]
    [InlineData("long-note")]
    [InlineData("blank-account-name")]
    [InlineData("nul-title")]
    [InlineData("lone-surrogate-note")]
    [InlineData("duplicate-transactions")]
    [InlineData("duplicate-categories")]
    [InlineData("anchor-day-zero")]
    [InlineData("anchor-day-32")]
    [InlineData("string-active")]
    [InlineData("daily-frequency")]
    [InlineData("receipt-without-uri")]
    [InlineData("long-receipt-name")]
    [InlineData("long-id")]
    [InlineData("missing-recurring")]
    public void whenLedgerBreaksLegacyRule_Read_ShouldReject(string mutation)
    {
        Read(Mutate(mutation)).ShouldBeNull(mutation);
    }

    [Fact]
    public void whenNamesHaveJavaScriptWhitespace_Read_ShouldTrimLikeJavaScript()
    {
        var body = JsonNode.Parse(Valid)!;
        body["ledger"]!["accounts"]![0]!["name"] = (char)0xFEFF + " Visa " + (char)0x2028;
        body["ledger"]!["trips"]![0]!["name"] = (char)0x3000 + "Trip" + (char)0x0085;
        body["ledger"]!["transactions"]![0]!["title"] = " Dinner ";
        var write = Read(body)!;
        write.Ledger.Accounts.Single().Name.ShouldBe("Visa");
        // U+0085 is not JavaScript whitespace, so it stays.
        write.Ledger.Trips.Single().Name.ShouldBe("Trip" + (char)0x0085);
        // Titles are never trimmed.
        write.Ledger.Transactions.Single().Title.ShouldBe(" Dinner ");
    }

    [Theory]
    [InlineData("1200.0", 1200L)]
    [InlineData("1.2e3", 1200L)]
    [InlineData("99999999999", 99999999999L)]
    public void whenAmountUsesJavaScriptNumberForm_Read_ShouldAcceptExactCents(
        string raw,
        long cents
    )
    {
        var text = Valid.Replace(
            "\"total\": 145000, \"share\": 145000",
            $"\"total\": {raw}, \"share\": {raw}",
            StringComparison.Ordinal
        );
        Read(JsonNode.Parse(text)!)!.Ledger.Recurring.Single().Total.ShouldBe(cents);
    }

    [Fact]
    public void whenImportedRevisionIsHuge_Read_ShouldAcceptItExactly()
    {
        var body = JsonNode.Parse(Valid)!;
        body["revision"] = 9_007_199_254_740_990;
        Read(body)!.Revision.ShouldBe(9_007_199_254_740_990);
    }

    [Fact]
    public void whenKeysRepeatOrAreUnknown_Read_ShouldUseLastValueAndIgnoreUnknown()
    {
        var text = Valid.Replace(
            "\"currency\": \"CAD\"",
            "\"currency\": \"JPY\", \"currency\": \"USD\", \"extra\": null",
            StringComparison.Ordinal
        );
        Read(JsonNode.Parse(text)!)!.Ledger.Currency.ShouldBe("USD");
    }

    [Theory]
    [InlineData("2024-02-29", true)]
    [InlineData("2026-02-30", false)]
    [InlineData("not-a-date", false)]
    [InlineData("2000-01-01", true)]
    [InlineData("2100-12-31", true)]
    [InlineData("1999-12-31", false)]
    [InlineData("2026-01-01 ", false)]
    public void whenCalendarDateChecked_TryParse_ShouldMatchLegacyValidDate(
        string value,
        bool valid
    )
    {
        LedgerDates.TryParse(value, out _).ShouldBe(valid);
    }

    private static LedgerWrite? Read(JsonNode body) => Read(body.ToJsonString());

    private static LedgerWrite? Read(string json)
    {
        using var document = JsonDocument.Parse(json);
        return LedgerReader.Read(document.RootElement);
    }

    private static JsonObject Category(string id, string kind) =>
        new()
        {
            ["id"] = id,
            ["name"] = "Category",
            ["icon"] = "pricetag-outline",
            ["color"] = "#678DB1",
            ["kind"] = kind,
        };

    private static string Mutate(string mutation)
    {
        var body = JsonNode.Parse(Valid)!;
        var ledger = body["ledger"]!.AsObject();
        var entry = ledger["transactions"]![0]!.AsObject();
        var rule = ledger["recurring"]![0]!.AsObject();
        switch (mutation)
        {
            case "transaction-account-missing":
                entry["accountId"] = "missing";
                break;
            case "recurring-account-missing":
                rule["accountId"] = "missing";
                break;
            case "duplicate-accounts":
                ledger["accounts"]!.AsArray().Add(ledger["accounts"]![0]!.DeepClone());
                break;
            case "unknown-account-type":
                ledger["accounts"]![0]!["type"] = "unknown";
                break;
            case "v3-without-accounts":
                ledger["version"] = 3;
                ledger.Remove("accounts");
                break;
            case "null-accounts":
                ledger["accounts"] = null;
                break;
            case "v4-without-trips":
                ledger.Remove("trips");
                entry.Remove("tripId");
                break;
            case "trip-ends-before-start":
                ledger["trips"]![0]!["endDate"] = "2026-09-01";
                break;
            case "trip-missing":
                entry["tripId"] = "missing";
                break;
            case "income-on-trip":
                entry["kind"] = "income";
                entry["categoryId"] = "salary";
                entry["share"] = 12000;
                break;
            case "recurring-on-trip":
                rule["tripId"] = "montreal";
                break;
            case "share-above-total":
                entry["share"] = 999999;
                break;
            case "investment-split":
                rule["kind"] = "investment";
                rule["categoryId"] = "investments";
                rule["share"] = 50000;
                break;
            case "category-kind-mismatch":
                rule["kind"] = "income";
                break;
            case "category-missing":
                entry["categoryId"] = "missing";
                break;
            case "unknown-kind":
                entry["kind"] = "unknown";
                break;
            case "negative-total":
                entry["total"] = -1;
                break;
            case "zero-total":
                entry["total"] = 0;
                entry["share"] = 0;
                break;
            case "fractional-total":
                entry["total"] = 12000.5;
                break;
            case "string-total":
                entry["total"] = "12000";
                break;
            case "total-above-max":
                entry["total"] = 100_000_000_000;
                break;
            case "impossible-date":
                entry["date"] = "2026-02-30";
                break;
            case "date-before-2000":
                entry["date"] = "1999-12-31";
                break;
            case "date-after-2100":
                rule["nextDate"] = "2101-01-01";
                break;
            case "short-date":
                entry["date"] = "2026-9-11";
                break;
            case "fullwidth-date":
                entry["date"] = new string((char)0xFF12, 1) + "026-09-11";
                break;
            case "null-account-id":
                entry["accountId"] = null;
                break;
            case "null-note":
                entry["note"] = null;
                break;
            case "version-5":
                ledger["version"] = 5;
                break;
            case "string-version":
                ledger["version"] = "4";
                break;
            case "unknown-currency":
                ledger["currency"] = "JPY";
                break;
            case "negative-revision":
                body["revision"] = -1;
                break;
            case "fractional-revision":
                body["revision"] = 0.5;
                break;
            case "string-revision":
                body["revision"] = "0";
                break;
            case "last-safe-revision":
                body["revision"] = LedgerLimits.MaxSafeInteger;
                break;
            case "unsafe-revision":
                body["revision"] = 9_007_199_254_740_993d;
                break;
            case "array-body":
                return new JsonArray(body.DeepClone()).ToJsonString();
            case "null-ledger":
                body["ledger"] = null;
                break;
            case "invalid-color":
                ledger["categories"]![0]!["color"] = "#E4785G";
                break;
            case "color-with-newline":
                ledger["categories"]![0]!["color"] = "#E47850\n";
                break;
            case "empty-category-name":
                ledger["categories"]![0]!["name"] = "";
                break;
            case "long-title":
                entry["title"] = new string('t', 101);
                break;
            case "long-note":
                entry["note"] = new string('n', 1001);
                break;
            case "blank-account-name":
                ledger["accounts"]![0]!["name"] = " \t ";
                break;
            case "nul-title":
                entry["title"] = "Din" + (char)0 + "ner";
                break;
            case "lone-surrogate-note":
                // Raw JSON: JsonNode cannot hold an unpaired surrogate.
                return Valid.Replace(
                    "\"date\": \"2026-09-11\", \"note\": \"\"",
                    "\"date\": \"2026-09-11\", \"note\": \"" + (char)92 + "ud800\"",
                    StringComparison.Ordinal
                );
            case "duplicate-transactions":
                ledger["transactions"]!.AsArray().Add(entry.DeepClone());
                break;
            case "duplicate-categories":
                ledger["categories"]!.AsArray().Add(ledger["categories"]![0]!.DeepClone());
                break;
            case "anchor-day-zero":
                rule["anchorDay"] = 0;
                break;
            case "anchor-day-32":
                rule["anchorDay"] = 32;
                break;
            case "string-active":
                rule["active"] = "true";
                break;
            case "daily-frequency":
                rule["frequency"] = "daily";
                break;
            case "receipt-without-uri":
                entry["receipt"]!.AsObject().Remove("uri");
                break;
            case "long-receipt-name":
                entry["receipt"]!["name"] = new string('r', 256);
                break;
            case "long-id":
                entry["id"] = new string('i', 101);
                break;
            case "missing-recurring":
                ledger.Remove("recurring");
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(mutation));
        }
        return body.ToJsonString();
    }
}
