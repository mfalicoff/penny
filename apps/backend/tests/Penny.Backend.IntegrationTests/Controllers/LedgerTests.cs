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

// Real HTTP + PostgreSQL ports of the legacy ledger journeys (tests/core/server,
// accounts, trips and contracts tests). All data is synthetic.
public sealed class LedgerTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    private const string Invalid = "Invalid ledger data.";
    private static readonly DateTimeOffset Now = new(2026, 10, 1, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task whenSnapshotWrittenAndReread_LedgerFlow_ShouldMatchLegacyJourney()
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
            await AuthTests.ShouldBeErrorAsync(
                stale,
                HttpStatusCode.Conflict,
                LedgerService.Conflict
            );
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
    public async Task whenOptionalFieldsAbsent_GetLedger_ShouldOmitThemInLegacyKeyOrder()
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
    public async Task whenBodyMalformedOrUnsupported_PutLedger_ShouldReturnLegacyErrors()
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
    public async Task whenOldClientOmitsNewCollections_PutLedger_ShouldUpgradeOrRefuseErasure()
    {
        var token = await RegisterAsync("owner@example.test");
        var snapshot = await GetAsync(token);

        // A v1 client on a ledger without accounts or trips is upgraded to v4.
        var legacy = snapshot.DeepClone();
        var ledger = legacy["ledger"]!.AsObject();
        ledger["version"] = 1;
        ledger.Remove("accounts");
        ledger.Remove("trips");
        ledger["categories"] = new JsonArray([
            .. ledger["categories"]!
                .AsArray()
                .Where(category => category!["kind"]!.GetValue<string>() != "investment")
                .Select(category => category!.DeepClone()),
        ]);
        using (var upgraded = await PutAsync(token, legacy))
        {
            upgraded.StatusCode.ShouldBe(HttpStatusCode.OK);
            var saved = (await ReadNodeAsync(upgraded))["ledger"]!;
            saved["version"]!.GetValue<int>().ShouldBe(4);
            saved["accounts"]!.AsArray().ShouldBeEmpty();
            saved["trips"]!.AsArray().ShouldBeEmpty();
            saved["categories"]!
                .AsArray()
                .Single(category => category!["kind"]!.GetValue<string>() == "investment")!["id"]!
                .GetValue<string>()
                .ShouldBe("investments");
        }

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

        var withoutAccounts = stored.DeepClone();
        withoutAccounts["ledger"]!["version"] = 2;
        withoutAccounts["ledger"]!.AsObject().Remove("accounts");
        withoutAccounts["ledger"]!.AsObject().Remove("trips");
        await ShouldFailAsync(token, withoutAccounts, LedgerService.ReloadForAccounts);
        var withoutTrips = stored.DeepClone();
        withoutTrips["ledger"]!["version"] = 3;
        withoutTrips["ledger"]!.AsObject().Remove("trips");
        await ShouldFailAsync(token, withoutTrips, LedgerService.ReloadForTrips);
        // A v3 client that does send trips keeps them.
        var v3WithTrips = stored.DeepClone();
        v3WithTrips["ledger"]!["version"] = 3;
        (await PutAsync(token, v3WithTrips)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await GetAsync(token))["ledger"]!["trips"]!.AsArray().Count.ShouldBe(1);
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
        // Checks precede the revision comparison, as in the legacy service.
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
    public async Task whenActiveHouseholdUsesOtherCurrency_PutLedger_ShouldRejectCurrency()
    {
        var token = await RegisterAsync("owner@example.test");
        var userId = await UserIdAsync("owner@example.test");
        await AddHouseholdAsync("household-usd", userId, "USD", archived: false, left: false);
        await AddHouseholdAsync("household-old", userId, "EUR", archived: true, left: false);
        await AddHouseholdAsync("household-left", userId, "GBP", archived: false, left: true);

        var snapshot = await GetAsync(token);
        await ShouldFailAsync(token, snapshot, LedgerService.CurrencyMismatch);
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
    public async Task whenImportedRevisionIsHuge_LedgerFlow_ShouldIncrementExactlyThenStop()
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
