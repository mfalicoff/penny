using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Penny.Backend.Application.Ledgers;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Personal ledger sync over real HTTP and PostgreSQL: the shared HTTP journey,
// accounts, trips, receipts, conflicts and isolation. All data is synthetic.
public sealed class LedgerTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    private const string Invalid = "Invalid ledger data.";
    private static readonly DateTimeOffset Now = new(2026, 10, 1, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task whenSnapshotWrittenAndReread_LedgerFlow_ShouldMatchContractJourney()
    {
        var journey = ContractFixtures.Read("http-journey.json");
        var token = await RegisterAsync("owner@example.test");
        var otherDevice = await LoginAsync("owner@example.test");
        var other = await RegisterAsync("other@example.test");

        var initial = await GetAsync(token);
        initial["revision"]!.GetValue<long>().ShouldBe(0);
        initial["ledger"]!["version"]!.GetValue<int>().ShouldBe(4);
        initial["ledger"]!["currency"]!.GetValue<string>().ShouldBe("CAD");
        initial["ledger"]!["categories"]!.AsArray().Count.ShouldBe(12);
        initial["ledger"]!["transactions"]!.AsArray().ShouldBeEmpty();

        var updated = initial.DeepClone();
        updated["ledger"]!["transactions"]!
            .AsArray()
            .Add(journey["write"]!["request"]!["entry"]!.DeepClone());
        using (var write = await PutAsync(token, updated))
        {
            write.StatusCode.ShouldBe(HttpStatusCode.OK);
            var saved = await ReadNodeAsync(write);
            saved["revision"]!.GetValue<long>().ShouldBe(1);
            JsonNode
                .DeepEquals(
                    saved["ledger"]!["transactions"]![0],
                    journey["write"]!["response"]!["entry"]
                )
                .ShouldBeTrue();
        }

        using (var stale = await PutAsync(token, updated))
        {
            await AuthTests.ShouldBeErrorAsync(
                stale,
                HttpStatusCode.Conflict,
                LedgerService.Conflict
            );
            JsonNode
                .DeepEquals(await ReadNodeAsync(stale), journey["staleWrite"]!["response"])
                .ShouldBeTrue();
        }
        var remote = await GetAsync(otherDevice);
        remote["revision"]!.GetValue<long>().ShouldBe(1);
        JsonNode
            .DeepEquals(
                remote["ledger"]!["transactions"]![0],
                journey["write"]!["response"]!["entry"]
            )
            .ShouldBeTrue();
        (await GetAsync(other))["ledger"]!["transactions"]!.AsArray().ShouldBeEmpty();
    }

    [Fact]
    public async Task whenOptionalFieldsAbsent_GetLedger_ShouldOmitThemInContractKeyOrder()
    {
        var token = await RegisterAsync("owner@example.test");
        var snapshot = await GetAsync(token);
        snapshot["ledger"]!["transactions"]!.AsArray().Add(Entry("lunch", "food", 1250, 625));
        (await PutAsync(token, snapshot)).StatusCode.ShouldBe(HttpStatusCode.OK);
        using var request = Authorized(HttpMethod.Get, "/api/ledger", bearer: token);
        using var response = await Client.SendAsync(request, Ct);
        var text = await response.Content.ReadAsStringAsync(Ct);
        text.ShouldNotContain("null");
        text.ShouldStartWith(
            "{\"revision\":1,\"ledger\":{\"version\":4,\"currency\":\"CAD\",\"accounts\":[],\"trips\":[],\"categories\":["
        );
        text.ShouldContain(
            "{\"id\":\"lunch\",\"title\":\"Synthetic lunch\",\"kind\":\"expense\",\"total\":1250,\"share\":625,\"categoryId\":\"food\",\"date\":\"2026-10-01\",\"note\":\"\"}"
        );
    }

    [Fact]
    public async Task whenExpensesHaveParticipants_LedgerFlow_ShouldStoreAndReturnThemAfterShare()
    {
        var token = await RegisterAsync("owner@example.test");
        var snapshot = await GetAsync(token);
        var split = Entry("dinner", "food", 9000, 3000);
        split["participants"] = 3;
        var transactions = snapshot["ledger"]!["transactions"]!.AsArray();
        transactions.Add(split);
        transactions.Add(Entry("lunch", "food", 1250, 1250));
        snapshot["ledger"]!["recurring"]!
            .AsArray()
            .Add(
                new JsonObject
                {
                    ["id"] = "rent",
                    ["title"] = "Synthetic rent",
                    ["kind"] = "expense",
                    ["total"] = 200000,
                    ["share"] = 100000,
                    ["participants"] = 2,
                    ["categoryId"] = "food",
                    ["date"] = "2026-10-01",
                    ["note"] = "",
                    ["frequency"] = "monthly",
                    ["nextDate"] = "2026-11-01",
                    ["anchorDay"] = 1,
                    ["active"] = true,
                }
            );
        (await PutAsync(token, snapshot)).StatusCode.ShouldBe(HttpStatusCode.OK);

        using var request = Authorized(HttpMethod.Get, "/api/ledger", bearer: token);
        using var response = await Client.SendAsync(request, Ct);
        var text = await response.Content.ReadAsStringAsync(Ct);
        text.ShouldContain(
            "{\"id\":\"dinner\",\"title\":\"Synthetic lunch\",\"kind\":\"expense\",\"total\":9000,\"share\":3000,\"participants\":3,\"categoryId\":\"food\",\"date\":\"2026-10-01\",\"note\":\"\"}"
        );
        text.ShouldContain(
            "{\"id\":\"lunch\",\"title\":\"Synthetic lunch\",\"kind\":\"expense\",\"total\":1250,\"share\":1250,\"categoryId\":\"food\",\"date\":\"2026-10-01\",\"note\":\"\"}"
        );
        text.ShouldContain(
            "{\"id\":\"rent\",\"title\":\"Synthetic rent\",\"kind\":\"expense\",\"total\":200000,\"share\":100000,\"participants\":2,\"categoryId\":\"food\",\"date\":\"2026-10-01\",\"note\":\"\",\"frequency\":\"monthly\",\"nextDate\":\"2026-11-01\",\"anchorDay\":1,\"active\":true}"
        );
        var userId = await UserIdAsync("owner@example.test");
        await using var context = PennyDbContext.Create(Fixture.Admin);
        (
            await context
                .LedgerEntries.Where(entry => entry.UserId == userId)
                .OrderBy(entry => entry.Id)
                .Select(entry => entry.Participants)
                .ToListAsync(Ct)
        ).ShouldBe([3, null]);
    }

    [Fact]
    public async Task whenParticipantsInvalid_PutLedger_ShouldRejectThem()
    {
        var token = await RegisterAsync("owner@example.test");
        var snapshot = await GetAsync(token);
        var single = Entry("solo", "food", 1000, 1000);
        single["participants"] = 1;
        var withSingle = snapshot.DeepClone();
        withSingle["ledger"]!["transactions"]!.AsArray().Add(single);
        await ShouldFailAsync(token, withSingle, Invalid);
        var explicitNull = Entry("none", "food", 1000, 1000);
        explicitNull["participants"] = null;
        var withNull = snapshot.DeepClone();
        withNull["ledger"]!["transactions"]!.AsArray().Add(explicitNull);
        await ShouldFailAsync(token, withNull, Invalid);
        (await GetAsync(token))["revision"]!.GetValue<long>().ShouldBe(0);
    }

    // Contract 2.4.0 (MAZ-151): synthetic entries paid in euros, yen and dinars.
    private static JsonObject Foreign(
        JsonObject entry,
        long amount,
        string currency,
        string rate,
        string status,
        string? rateDate
    )
    {
        entry["originalAmount"] = amount;
        entry["originalCurrency"] = currency;
        entry["rate"] = rate;
        entry["rateStatus"] = status;
        if (rateDate is not null)
            entry["rateDate"] = rateDate;
        return entry;
    }

    [Fact]
    public async Task whenEntriesPaidInOtherCurrencies_LedgerFlow_ShouldStoreAndReturnThemUnchanged()
    {
        var token = await RegisterAsync("owner@example.test");
        var snapshot = await GetAsync(token);
        var transactions = snapshot["ledger"]!["transactions"]!.AsArray();
        transactions.Add(
            Foreign(
                Entry("class", "food", 12420, 6210),
                8500,
                "EUR",
                "1.4612",
                "published",
                "2026-11-03"
            )
        );
        transactions.Add(
            Foreign(
                Entry("noodles", "food", 1088, 1088),
                1200,
                "JPY",
                "0.00906283",
                "provisional",
                "2026-11-02"
            )
        );
        transactions.Add(
            Foreign(Entry("tea", "food", 553, 553), 1234, "KWD", "4.48", "edited", null)
        );
        transactions.Add(Entry("lunch", "food", 1250, 1250));
        (await PutAsync(token, snapshot)).StatusCode.ShouldBe(HttpStatusCode.OK);

        using var request = Authorized(HttpMethod.Get, "/api/ledger", bearer: token);
        using var response = await Client.SendAsync(request, Ct);
        var text = await response.Content.ReadAsStringAsync(Ct);
        text.ShouldContain(
            "{\"id\":\"class\",\"title\":\"Synthetic lunch\",\"kind\":\"expense\",\"total\":12420,\"share\":6210,\"categoryId\":\"food\",\"date\":\"2026-10-01\",\"note\":\"\",\"originalAmount\":8500,\"originalCurrency\":\"EUR\",\"rate\":\"1.4612\",\"rateStatus\":\"published\",\"rateDate\":\"2026-11-03\"}"
        );
        text.ShouldContain(
            "{\"id\":\"noodles\",\"title\":\"Synthetic lunch\",\"kind\":\"expense\",\"total\":1088,\"share\":1088,\"categoryId\":\"food\",\"date\":\"2026-10-01\",\"note\":\"\",\"originalAmount\":1200,\"originalCurrency\":\"JPY\",\"rate\":\"0.00906283\",\"rateStatus\":\"provisional\",\"rateDate\":\"2026-11-02\"}"
        );
        text.ShouldContain(
            "{\"id\":\"tea\",\"title\":\"Synthetic lunch\",\"kind\":\"expense\",\"total\":553,\"share\":553,\"categoryId\":\"food\",\"date\":\"2026-10-01\",\"note\":\"\",\"originalAmount\":1234,\"originalCurrency\":\"KWD\",\"rate\":\"4.48\",\"rateStatus\":\"edited\"}"
        );
        text.ShouldContain(
            "{\"id\":\"lunch\",\"title\":\"Synthetic lunch\",\"kind\":\"expense\",\"total\":1250,\"share\":1250,\"categoryId\":\"food\",\"date\":\"2026-10-01\",\"note\":\"\"}"
        );
        var userId = await UserIdAsync("owner@example.test");
        await using var context = PennyDbContext.Create(Fixture.Admin);
        (
            await context
                .LedgerEntries.Where(entry => entry.UserId == userId)
                .OrderBy(entry => entry.Id)
                .Select(entry => new
                {
                    entry.Id,
                    entry.OriginalCurrency,
                    entry.Rate,
                    entry.RateStatus,
                    entry.RateDate,
                })
                .ToListAsync(Ct)
        ).Select(row => (row.Id, row.OriginalCurrency, row.Rate, row.RateStatus, row.RateDate)).ShouldBe([("class", "EUR", "1.4612", "published", new DateOnly(2026, 11, 3)), ("lunch", null, null, null, null), ("noodles", "JPY", "0.00906283", "provisional", new DateOnly(2026, 11, 2)), ("tea", "KWD", "4.48", "edited", (DateOnly?)null)]);
    }

    [Theory]
    [InlineData("total-mismatch")]
    [InlineData("home-currency")]
    [InlineData("partial")]
    [InlineData("rate-date-alone")]
    [InlineData("edited-with-date")]
    [InlineData("published-without-date")]
    [InlineData("non-canonical-rate")]
    [InlineData("null-rate")]
    [InlineData("recurring-rule")]
    public async Task whenForeignAmountInvalid_PutLedger_ShouldRejectTheLedger(string mutation)
    {
        var token = await RegisterAsync("owner@example.test");
        var snapshot = await GetAsync(token);
        var entry = Foreign(
            Entry("class", "food", 12420, 12420),
            8500,
            "EUR",
            "1.4612",
            "published",
            "2026-11-03"
        );
        switch (mutation)
        {
            case "total-mismatch":
                entry["total"] = 12421;
                break;
            case "home-currency":
                Foreign(entry, 12420, "CAD", "1", "published", "2026-11-03");
                break;
            case "partial":
                entry.Remove("rate");
                break;
            case "rate-date-alone":
                entry = Entry("class", "food", 12420, 12420);
                entry["rateDate"] = "2026-11-03";
                break;
            case "edited-with-date":
                entry["rateStatus"] = "edited";
                break;
            case "published-without-date":
                entry.Remove("rateDate");
                break;
            case "non-canonical-rate":
                entry["rate"] = "1.46120";
                break;
            case "null-rate":
                entry["rate"] = null;
                break;
            case "recurring-rule":
                entry["frequency"] = "monthly";
                entry["nextDate"] = "2026-11-01";
                entry["anchorDay"] = 1;
                entry["active"] = true;
                snapshot["ledger"]!["recurring"]!.AsArray().Add(entry);
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(mutation));
        }
        if (mutation != "recurring-rule")
            snapshot["ledger"]!["transactions"]!.AsArray().Add(entry);
        await ShouldFailAsync(token, snapshot, Invalid);
        (await GetAsync(token))["revision"]!.GetValue<long>().ShouldBe(0);
    }

    [Fact]
    public async Task whenDismissedSuggestionsSaved_LedgerFlow_ShouldReturnThemInOrderUntilOmitted()
    {
        var token = await RegisterAsync("owner@example.test");
        var userId = await UserIdAsync("owner@example.test");
        var snapshot = await GetAsync(token);
        string[] first =
        [
            "expense|netflix|monthly|1699",
            "expense|gym|monthly|4500",
            "income|acme payroll|weekly|120000",
        ];
        snapshot["ledger"]!["dismissedSuggestions"] = new JsonArray([.. first.Select(Text)]);
        using (var write = await PutAsync(token, snapshot))
        {
            write.StatusCode.ShouldBe(HttpStatusCode.OK);
            Dismissed(await ReadNodeAsync(write)).ShouldBe(first);
        }
        using (var request = Authorized(HttpMethod.Get, "/api/ledger", bearer: token))
        using (var response = await Client.SendAsync(request, Ct))
        {
            // The last ledger key, after `recurring`, in the order sent.
            (await response.Content.ReadAsStringAsync(Ct)).ShouldEndWith(
                "\"recurring\":[],\"dismissedSuggestions\":[\"expense|netflix|monthly|1699\",\"expense|gym|monthly|4500\",\"income|acme payroll|weekly|120000\"]}}"
            );
        }

        // Reordered, one removed and one added: positions follow the new order.
        var reordered = await GetAsync(token);
        string[] second =
        [
            "income|acme payroll|weekly|120000",
            "expense|netflix|monthly|1699",
            "expense|spotify|monthly|1199",
        ];
        reordered["ledger"]!["dismissedSuggestions"] = new JsonArray([.. second.Select(Text)]);
        (await PutAsync(token, reordered)).StatusCode.ShouldBe(HttpStatusCode.OK);
        Dismissed(await GetAsync(token)).ShouldBe(second);

        // A duplicate is invalid and changes nothing.
        var duplicate = await GetAsync(token);
        duplicate["ledger"]!["dismissedSuggestions"]!.AsArray().Add("expense|netflix|monthly|1699");
        await ShouldFailAsync(token, duplicate, Invalid);
        Dismissed(await GetAsync(token)).ShouldBe(second);

        // A ledger written without the field has none: it is omitted, and no rows remain.
        var cleared = await GetAsync(token);
        cleared["ledger"]!.AsObject().Remove("dismissedSuggestions");
        using (var write = await PutAsync(token, cleared))
        {
            write.StatusCode.ShouldBe(HttpStatusCode.OK);
            (await ReadNodeAsync(write))["ledger"]!
                .AsObject()
                .ContainsKey("dismissedSuggestions")
                .ShouldBeFalse();
        }
        var reread = await GetAsync(token);
        reread["revision"]!.GetValue<long>().ShouldBe(3);
        reread["ledger"]!.AsObject().ContainsKey("dismissedSuggestions").ShouldBeFalse();
        await using var context = PennyDbContext.Create(Fixture.Admin);
        (
            await context.LedgerDismissedSuggestions.CountAsync(
                suggestion => suggestion.UserId == userId,
                Ct
            )
        ).ShouldBe(0);

        static JsonNode? Text(string value) => JsonValue.Create(value);
        static List<string> Dismissed(JsonNode snapshot) =>
            [
                .. snapshot["ledger"]!["dismissedSuggestions"]!
                    .AsArray()
                    .Select(value => value!.GetValue<string>()),
            ];
    }

    [Fact]
    public async Task whenSessionMissing_LedgerFlow_ShouldRequireSignIn()
    {
        using var read = await Client.GetAsync("/api/ledger", Ct);
        read.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        using var write = await Client.PutAsync(
            "/api/ledger",
            new StringContent("{}", Encoding.UTF8, "application/json"),
            Ct
        );
        write.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task whenWritersRaceOnOneRevision_PutLedger_ShouldAcceptExactlyOne()
    {
        var token = await RegisterAsync("owner@example.test");
        var snapshot = await GetAsync(token);
        var responses = await Task.WhenAll(
            Enumerable
                .Range(0, 6)
                .Select(index =>
                {
                    var copy = snapshot.DeepClone();
                    copy["ledger"]!["transactions"]!
                        .AsArray()
                        .Add(Entry("race-" + index, "food", 100, 100));
                    return PutAsync(token, copy);
                })
        );
        try
        {
            responses.Count(response => response.StatusCode == HttpStatusCode.OK).ShouldBe(1);
            responses.Count(response => response.StatusCode == HttpStatusCode.Conflict).ShouldBe(5);
        }
        finally
        {
            foreach (var response in responses)
                response.Dispose();
        }
        var final = await GetAsync(token);
        final["revision"]!.GetValue<long>().ShouldBe(1);
        final["ledger"]!["transactions"]!.AsArray().Count.ShouldBe(1);
    }

    [Fact]
    public async Task whenDevicesEditIndependently_LedgerFlow_ShouldKeepBothEditsAfterRetry()
    {
        var phone = await RegisterAsync("owner@example.test");
        var laptop = await LoginAsync("owner@example.test");
        var phoneBase = await GetAsync(phone);
        var laptopBase = await GetAsync(laptop);

        phoneBase["ledger"]!["transactions"]!.AsArray().Add(Entry("from-phone", "food", 500, 500));
        (await PutAsync(phone, phoneBase)).StatusCode.ShouldBe(HttpStatusCode.OK);
        laptopBase["ledger"]!["transactions"]!
            .AsArray()
            .Add(Entry("from-laptop", "home", 900, 450));
        using (var stale = await PutAsync(laptop, laptopBase))
            stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);

        // The client protocol: refetch, re-apply the local change, retry.
        var latest = await GetAsync(laptop);
        latest["ledger"]!["transactions"]!.AsArray().Add(Entry("from-laptop", "home", 900, 450));
        (await PutAsync(laptop, latest)).StatusCode.ShouldBe(HttpStatusCode.OK);

        var final = await GetAsync(phone);
        final["revision"]!.GetValue<long>().ShouldBe(2);
        final["ledger"]!["transactions"]!
            .AsArray()
            .Select(entry => entry!["id"]!.GetValue<string>())
            .Order(StringComparer.Ordinal)
            .ShouldBe(["from-laptop", "from-phone"]);
    }

    [Fact]
    public async Task whenBodyMalformedOrUnsupported_PutLedger_ShouldReturnContractErrors()
    {
        var token = await RegisterAsync("owner@example.test");
        var snapshot = await GetAsync(token);
        var future = snapshot.DeepClone();
        future["ledger"]!["version"] = 5;
        await ShouldFailAsync(token, future, Invalid);
        var dangling = snapshot.DeepClone();
        dangling["ledger"]!["transactions"]!.AsArray().Add(Entry("lunch", "missing", 100, 100));
        await ShouldFailAsync(token, dangling, Invalid);
        var nullAccount = snapshot.DeepClone();
        var entry = Entry("lunch", "food", 100, 100);
        entry["accountId"] = null;
        nullAccount["ledger"]!["transactions"]!.AsArray().Add(entry);
        await ShouldFailAsync(token, nullAccount, Invalid);
        var tooSplit = snapshot.DeepClone();
        tooSplit["ledger"]!["transactions"]!.AsArray().Add(Entry("lunch", "food", 100, 999999));
        await ShouldFailAsync(token, tooSplit, Invalid);

        foreach (
            var (body, type, message) in new[]
            {
                ("{\"revision\":", "application/json", "Invalid JSON."),
                ("42", "application/json", "Invalid JSON."),
                (snapshot.ToJsonString(), "text/plain", Invalid),
                ("[]", "application/json", Invalid),
            }
        )
        {
            using var request = Authorized(HttpMethod.Put, "/api/ledger", bearer: token);
            request.Content = new StringContent(body, Encoding.UTF8, type);
            using var response = await Client.SendAsync(request, Ct);
            await AuthTests.ShouldBeErrorAsync(response, HttpStatusCode.BadRequest, message);
        }
        (await GetAsync(token))["revision"]!.GetValue<long>().ShouldBe(0);
    }

    [Fact]
    public async Task whenOriginUntrusted_PutLedger_ShouldBeForbidden()
    {
        var token = await RegisterAsync("owner@example.test");
        var snapshot = await GetAsync(token);
        using var request = Authorized(HttpMethod.Put, "/api/ledger", bearer: token);
        request.Headers.Add("Origin", "https://untrusted.example.test");
        request.Content = new StringContent(
            snapshot.ToJsonString(),
            Encoding.UTF8,
            "application/json"
        );
        using var response = await Client.SendAsync(request, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await GetAsync(token))["revision"]!.GetValue<long>().ShouldBe(0);
    }

    [Fact]
    public async Task whenLedgerIsNotCompleteVersionFour_PutLedger_ShouldRejectAndKeepData()
    {
        var token = await RegisterAsync("owner@example.test");
        var current = await GetAsync(token);
        current["ledger"]!["accounts"]!
            .AsArray()
            .Add(
                new JsonObject
                {
                    ["id"] = "visa",
                    ["name"] = "Visa",
                    ["type"] = "credit",
                }
            );
        current["ledger"]!["trips"]!.AsArray().Add(Trip("montreal", null));
        (await PutAsync(token, current)).StatusCode.ShouldBe(HttpStatusCode.OK);
        var stored = await GetAsync(token);

        // Versions before 4 and ledgers that omit accounts or trips are invalid, so
        // nothing a client leaves out is erased.
        foreach (var version in new[] { 1, 2, 3 })
        {
            var older = stored.DeepClone();
            older["ledger"]!["version"] = version;
            await ShouldFailAsync(token, older, Invalid);
        }
        foreach (var collection in new[] { "accounts", "trips" })
        {
            var partial = stored.DeepClone();
            partial["ledger"]!.AsObject().Remove(collection);
            await ShouldFailAsync(token, partial, Invalid);
        }
        var after = await GetAsync(token);
        after["revision"]!.GetValue<long>().ShouldBe(stored["revision"]!.GetValue<long>());
        after["ledger"]!["accounts"]!.AsArray().Count.ShouldBe(1);
        after["ledger"]!["trips"]!.AsArray().Count.ShouldBe(1);
    }

    [Fact]
    public async Task whenReceiptOwnedElsewhereOrMissing_PutLedger_ShouldRejectReceipt()
    {
        var owner = await RegisterAsync("owner@example.test");
        var other = await RegisterAsync("other@example.test");
        await AddReceiptAsync(await UserIdAsync("owner@example.test"), "receipt-1", "Dinner.pdf");

        var foreign = await GetAsync(other);
        var stolen = Entry("dinner", "food", 1200, 600);
        stolen["receipt"] = Receipt("receipt-1");
        foreign["ledger"]!["transactions"]!.AsArray().Add(stolen);
        await ShouldFailAsync(other, foreign, LedgerService.ForeignReceipt);
        // Checks precede the revision comparison.
        foreign["revision"] = 7;
        await ShouldFailAsync(other, foreign, LedgerService.ForeignReceipt);

        var mine = await GetAsync(owner);
        var missing = Entry("dinner", "food", 1200, 600);
        missing["receipt"] = Receipt("not-uploaded");
        mine["ledger"]!["transactions"]!.AsArray().Add(missing);
        await ShouldFailAsync(owner, mine, LedgerService.ForeignReceipt);

        // The owner's own receipt is accepted; stored metadata replaces client text.
        mine["ledger"]!["transactions"]![0]!["receipt"] = Receipt("receipt-1");
        using (var saved = await PutAsync(owner, mine))
        {
            saved.StatusCode.ShouldBe(HttpStatusCode.OK);
            ShouldBeStoredReceipt(
                (await ReadNodeAsync(saved))["ledger"]!["transactions"]![0]!["receipt"]!
            );
        }
        ShouldBeStoredReceipt((await GetAsync(owner))["ledger"]!["transactions"]![0]!["receipt"]!);
        (await GetAsync(other))["ledger"]!["transactions"]!.AsArray().ShouldBeEmpty();
    }

    [Fact]
    public async Task whenAccountIdsOverlapAcrossUsers_PutLedger_ShouldIsolateAccounts()
    {
        var owner = await RegisterAsync("owner@example.test");
        var other = await RegisterAsync("other@example.test");
        var mine = await GetAsync(owner);
        mine["ledger"]!["accounts"]!
            .AsArray()
            .Add(
                new JsonObject
                {
                    ["id"] = "visa",
                    ["name"] = "Visa",
                    ["type"] = "credit",
                }
            );
        var paid = Entry("dinner", "food", 1200, 600);
        paid["accountId"] = "visa";
        mine["ledger"]!["transactions"]!.AsArray().Add(paid);
        (await PutAsync(owner, mine)).StatusCode.ShouldBe(HttpStatusCode.OK);

        // Another user cannot reference the owner's account without having one.
        var theirs = await GetAsync(other);
        theirs["ledger"]!["transactions"]!.AsArray().Add(paid.DeepClone());
        await ShouldFailAsync(other, theirs, Invalid);
        // The same id is an independent account in their own ledger.
        theirs["ledger"]!["accounts"]!
            .AsArray()
            .Add(
                new JsonObject
                {
                    ["id"] = "visa",
                    ["name"] = "Their card",
                    ["type"] = "bank",
                }
            );
        (await PutAsync(other, theirs)).StatusCode.ShouldBe(HttpStatusCode.OK);
        theirs = await GetAsync(other);
        theirs["ledger"]!["accounts"] = new JsonArray();
        theirs["ledger"]!["transactions"] = new JsonArray();
        (await PutAsync(other, theirs)).StatusCode.ShouldBe(HttpStatusCode.OK);

        var unchanged = await GetAsync(owner);
        unchanged["ledger"]!["accounts"]![0]!["name"]!.GetValue<string>().ShouldBe("Visa");
        unchanged["ledger"]!["transactions"]![0]!["accountId"]!.GetValue<string>().ShouldBe("visa");
    }

    [Fact]
    public async Task whenActiveHouseholdUsesOtherCurrency_PutLedger_ShouldSaveTheLedgerCurrency()
    {
        var token = await RegisterAsync("owner@example.test");
        var userId = await UserIdAsync("owner@example.test");
        await AddHouseholdAsync("household-usd", userId, "USD", archived: false, left: false);
        await AddHouseholdAsync("household-old", userId, "EUR", archived: true, left: false);
        await AddHouseholdAsync("household-left", userId, "GBP", archived: false, left: true);

        // Ledger check 3 is gone (contract 2.6.0): members keep their ledgers in their own
        // currency, whatever their households use.
        var snapshot = await GetAsync(token);
        snapshot["ledger"]!["currency"] = "GBP";
        using (var british = await PutAsync(token, snapshot))
            british.StatusCode.ShouldBe(HttpStatusCode.OK);
        snapshot = await GetAsync(token);
        snapshot["ledger"]!["currency"] = "USD";
        using var saved = await PutAsync(token, snapshot);
        saved.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await ReadNodeAsync(saved))["ledger"]!["currency"]!.GetValue<string>().ShouldBe("USD");
    }

    [Fact]
    public async Task whenHouseholdExpenseUsesAccount_PutLedger_ShouldRefuseDeletingIt()
    {
        var token = await RegisterAsync("owner@example.test");
        var userId = await UserIdAsync("owner@example.test");
        var snapshot = await GetAsync(token);
        snapshot["ledger"]!["accounts"]!
            .AsArray()
            .Add(
                new JsonObject
                {
                    ["id"] = "visa",
                    ["name"] = "Visa",
                    ["type"] = "credit",
                }
            );
        snapshot["ledger"]!["accounts"]!
            .AsArray()
            .Add(
                new JsonObject
                {
                    ["id"] = "cash",
                    ["name"] = "Wallet",
                    ["type"] = "cash",
                }
            );
        (await PutAsync(token, snapshot)).StatusCode.ShouldBe(HttpStatusCode.OK);
        await AddHouseholdAsync("household", userId, "CAD", archived: false, left: false);
        await AddExpenseAsync("expense-live", "household", userId, "visa", deleted: false);
        await AddExpenseAsync("expense-deleted", "household", userId, "cash", deleted: true);

        var current = await GetAsync(token);
        var withoutVisa = current.DeepClone();
        withoutVisa["ledger"]!["accounts"] = new JsonArray(
            new JsonObject
            {
                ["id"] = "cash",
                ["name"] = "Wallet",
                ["type"] = "cash",
            }
        );
        await ShouldFailAsync(token, withoutVisa, LedgerService.LinkedAccount);
        var withoutCash = current.DeepClone();
        withoutCash["ledger"]!["accounts"] = new JsonArray(
            new JsonObject
            {
                ["id"] = "visa",
                ["name"] = "Visa",
                ["type"] = "credit",
            }
        );
        (await PutAsync(token, withoutCash)).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenTripLinksHousehold_PutLedger_ShouldRequireExistingHousehold()
    {
        var token = await RegisterAsync("owner@example.test");
        var userId = await UserIdAsync("owner@example.test");
        await AddHouseholdAsync("trip-group", userId, "CAD", archived: false, left: false);
        var snapshot = await GetAsync(token);
        snapshot["ledger"]!["trips"]!.AsArray().Add(Trip("montreal", "no-such-household"));
        await ShouldFailAsync(token, snapshot, Invalid);
        snapshot["ledger"]!["trips"]![0]!["sharedHouseholdId"] = "trip-group";
        using var saved = await PutAsync(token, snapshot);
        saved.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await GetAsync(token))["ledger"]!["trips"]![0]!["sharedHouseholdId"]!
            .GetValue<string>()
            .ShouldBe("trip-group");
    }

    [Fact]
    public async Task whenRevisionIsHuge_LedgerFlow_ShouldIncrementExactlyThenStop()
    {
        var token = await RegisterAsync("owner@example.test");
        var userId = await UserIdAsync("owner@example.test");
        await using (var context = PennyDbContext.Create(Fixture.Admin))
            await context
                .Ledgers.Where(ledger => ledger.UserId == userId)
                .ExecuteUpdateAsync(
                    set => set.SetProperty(ledger => ledger.Revision, 9_007_199_254_740_990L),
                    Ct
                );

        var snapshot = await GetAsync(token);
        snapshot["revision"]!.GetValue<long>().ShouldBe(9_007_199_254_740_990);
        using (var saved = await PutAsync(token, snapshot))
            (await ReadNodeAsync(saved))["revision"]!
                .GetValue<long>()
                .ShouldBe(9_007_199_254_740_991);
        var last = await GetAsync(token);
        last["revision"]!.GetValue<long>().ShouldBe(9_007_199_254_740_991);
        await ShouldFailAsync(token, last, Invalid);
    }

    private async Task<string> LoginAsync(string email)
    {
        using var response = await Client.PostAsJsonAsync(
            "/api/auth/login",
            new { email, password = TestPassword },
            Ct
        );
        response.EnsureSuccessStatusCode();
        return (await ReadNodeAsync(response))["token"]!.GetValue<string>();
    }

    private async Task<JsonNode> GetAsync(string token)
    {
        using var request = Authorized(HttpMethod.Get, "/api/ledger", bearer: token);
        using var response = await Client.SendAsync(request, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return await ReadNodeAsync(response);
    }

    private async Task<HttpResponseMessage> PutAsync(string token, JsonNode body)
    {
        using var request = Authorized(HttpMethod.Put, "/api/ledger", bearer: token);
        request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        return await Client.SendAsync(request, Ct);
    }

    private async Task ShouldFailAsync(string token, JsonNode body, string message)
    {
        using var response = await PutAsync(token, body);
        await AuthTests.ShouldBeErrorAsync(response, HttpStatusCode.BadRequest, message);
    }

    private static async Task<JsonNode> ReadNodeAsync(HttpResponseMessage response) =>
        JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!;

    private static JsonObject Entry(string id, string categoryId, long total, long share) =>
        new()
        {
            ["id"] = id,
            ["title"] = "Synthetic lunch",
            ["kind"] = "expense",
            ["total"] = total,
            ["share"] = share,
            ["categoryId"] = categoryId,
            ["date"] = "2026-10-01",
            ["note"] = "",
        };

    private static JsonObject Trip(string id, string? householdId)
    {
        var trip = new JsonObject
        {
            ["id"] = id,
            ["name"] = "Synthetic trip",
            ["startDate"] = "2026-09-10",
            ["endDate"] = "2026-09-14",
        };
        if (householdId is not null)
            trip["sharedHouseholdId"] = householdId;
        return trip;
    }

    private static JsonObject Receipt(string id) =>
        new()
        {
            ["id"] = id,
            ["name"] = "client-chosen.pdf",
            ["mime"] = "image/png",
            ["uri"] = "file:///synthetic",
        };

    private static void ShouldBeStoredReceipt(JsonNode receipt)
    {
        receipt["id"]!.GetValue<string>().ShouldBe("receipt-1");
        receipt["name"]!.GetValue<string>().ShouldBe("Dinner.pdf");
        receipt["mime"]!.GetValue<string>().ShouldBe("application/pdf");
        receipt["uri"]!.GetValue<string>().ShouldBe("/api/receipts/receipt-1");
    }

    private async Task<string> UserIdAsync(string email)
    {
        await using var context = PennyDbContext.Create(Fixture.Admin);
        return await context
            .Users.Where(user => user.Email == email)
            .Select(user => user.Id)
            .SingleAsync(Ct);
    }

    private async Task AddReceiptAsync(string userId, string id, string name)
    {
        var encrypted = Fixture.Receipts.Encrypt(
            userId,
            id,
            name,
            "application/pdf",
            "%PDF-1.4"u8,
            Now
        );
        await using var context = PennyDbContext.Create(Fixture.Admin);
        context.Receipts.Add(encrypted.Row);
        await context.SaveChangesAsync(Ct);
    }

    private async Task AddHouseholdAsync(
        string id,
        string userId,
        string currency,
        bool archived,
        bool left
    )
    {
        await using var context = PennyDbContext.Create(Fixture.Admin);
        context.Households.Add(
            new Household
            {
                Id = id,
                Name = "Synthetic household",
                Currency = currency,
                CreatorId = userId,
                CreatedAt = Now,
                ArchivedAt = archived ? Now : null,
            }
        );
        context.HouseholdMemberPeriods.Add(
            new HouseholdMemberPeriod
            {
                Id = id + "-member",
                HouseholdId = id,
                UserId = userId,
                JoinedAt = Now,
                LeftAt = left ? Now : null,
            }
        );
        await context.SaveChangesAsync(Ct);
    }

    private async Task AddExpenseAsync(
        string id,
        string householdId,
        string payerId,
        string accountId,
        bool deleted
    )
    {
        await using var context = PennyDbContext.Create(Fixture.Admin);
        context.HouseholdExpenses.Add(
            new HouseholdExpense
            {
                Id = id,
                HouseholdId = householdId,
                Title = "Synthetic groceries",
                TotalCents = 1000,
                ExpenseDate = new DateOnly(2026, 10, 1),
                PayerId = payerId,
                SplitMode = "equal",
                CategoryName = "Groceries",
                CategoryIcon = "basket-outline",
                CategoryColor = "#6C9C79",
                Note = "",
                AccountId = accountId,
                CreatedBy = payerId,
                CreatedAt = Now,
                UpdatedBy = payerId,
                UpdatedAt = Now,
                DeletedAt = deleted ? Now : null,
            }
        );
        await context.SaveChangesAsync(Ct);
    }
}
