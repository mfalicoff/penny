using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Penny.Backend.Domain.Errors;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Captured purchases in the Inbox (MAZ-291, contract 2.5.0) over real HTTP and PostgreSQL:
// idempotent capture, validation, the owner-only list, triage outcomes with Undo, and the
// card mapping. All merchants, cards and amounts are synthetic.
public sealed class PurchaseInboxTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    private static readonly DateTimeOffset Now = new(2026, 11, 20, 15, 0, 0, TimeSpan.Zero);

    private static object Capture(
        string key,
        string merchant = "Corner Bakery",
        long amount = 675,
        string currency = "CAD",
        string? card = "Visa 0001",
        DateTimeOffset? at = null
    ) =>
        new
        {
            idempotencyKey = key,
            merchant,
            amount,
            currency,
            card,
            capturedAt = (at ?? Now.AddMinutes(-5)).ToUnixTimeMilliseconds(),
        };

    private async Task<(HttpStatusCode Status, JsonElement Body)> SendAsync(
        HttpMethod method,
        string path,
        string token,
        object? body = null
    )
    {
        using var request = Authorized(method, path, bearer: token);
        if (body is not null)
            request.Content = JsonContent.Create(body);
        using var response = await Client.SendAsync(request, Ct);
        var text = await response.Content.ReadAsStringAsync(Ct);
        return (response.StatusCode, JsonDocument.Parse(text).RootElement.Clone());
    }

    private async Task<JsonElement> CaptureAsync(string token, object body, HttpStatusCode expected)
    {
        var (status, item) = await SendAsync(HttpMethod.Post, "/api/purchase-inbox", token, body);
        status.ShouldBe(expected, item.ToString());
        return item;
    }

    private async Task<IReadOnlyList<JsonElement>> ListAsync(
        string token,
        string status = "to_review"
    )
    {
        var (code, page) = await SendAsync(
            HttpMethod.Get,
            $"/api/purchase-inbox?status={status}",
            token
        );
        code.ShouldBe(HttpStatusCode.OK, page.ToString());
        page.GetProperty("next").ValueKind.ShouldBe(JsonValueKind.Null);
        return [.. page.GetProperty("items").EnumerateArray()];
    }

    private static string Code(JsonElement error) => error.GetProperty("code").GetString()!;

    [Fact]
    public async Task whenSameTapUploadedTwice_CapturePurchase_ShouldKeepOneItem()
    {
        Fixture.Factory.Clock.Set(Now);
        var token = await RegisterAsync("capture@example.test");
        var first = await CaptureAsync(
            token,
            Capture("tap-1", merchant: "  Corner Bakery "),
            HttpStatusCode.Created
        );
        first.GetProperty("merchant").GetString().ShouldBe("Corner Bakery");
        first.GetProperty("amount").GetInt64().ShouldBe(675);
        first.GetProperty("currency").GetString().ShouldBe("CAD");
        first.GetProperty("card").GetString().ShouldBe("Visa 0001");
        first.GetProperty("status").GetString().ShouldBe("to_review");
        first.GetProperty("outcome").ValueKind.ShouldBe(JsonValueKind.Null);
        first.GetProperty("createdAt").GetInt64().ShouldBe(Now.ToUnixTimeMilliseconds());

        var again = await CaptureAsync(token, Capture("tap-1", amount: 999), HttpStatusCode.OK);
        again.GetProperty("id").GetString().ShouldBe(first.GetProperty("id").GetString());
        again.GetProperty("amount").GetInt64().ShouldBe(675, "the first upload wins");

        await CaptureAsync(
            token,
            Capture("tap-2", currency: "USD", card: null, at: Now.AddDays(-1)),
            HttpStatusCode.Created
        );
        var items = await ListAsync(token);
        foreach (var item in items)
            item.TryGetProperty("idempotencyKey", out _).ShouldBeFalse();
        items.Count.ShouldBe(2);
        items[0]
            .GetProperty("id")
            .GetString()
            .ShouldBe(first.GetProperty("id").GetString(), "newest capture first");
        items[1].GetProperty("card").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task whenCaptureIsInvalid_CapturePurchase_ShouldRefuseAndStoreNothing()
    {
        Fixture.Factory.Clock.Set(Now);
        var token = await RegisterAsync("invalid-capture@example.test");
        foreach (
            var body in new object[]
            {
                Capture("bad-1", amount: 0),
                Capture("bad-2", amount: -5),
                Capture("bad-3", currency: "XYZ"),
                Capture("bad-4", merchant: "   "),
                Capture("bad-5", merchant: new string('m', 101)),
                Capture("bad-6", card: new string('c', 51)),
                Capture("bad key with spaces"),
                Capture(new string('k', 65)),
                Capture("bad-7", at: Now.AddDays(2)),
                Capture("bad-8", at: new DateTimeOffset(2019, 1, 1, 0, 0, 0, TimeSpan.Zero)),
                new
                {
                    idempotencyKey = "bad-9",
                    merchant = "Shop",
                    amount = 1,
                    currency = "CAD",
                    capturedAt = 1,
                    extra = true,
                },
                new
                {
                    idempotencyKey = "bad-10",
                    merchant = "Shop",
                    amount = 1.5,
                    currency = "CAD",
                    capturedAt = Now.ToUnixTimeMilliseconds(),
                },
                new
                {
                    merchant = "Shop",
                    amount = 1,
                    currency = "CAD",
                    capturedAt = Now.ToUnixTimeMilliseconds(),
                },
            }
        )
        {
            var error = await CaptureAsync(token, body, HttpStatusCode.BadRequest);
            Code(error).ShouldBe(ErrorCodes.PurchaseInboxInvalidCapture);
        }
        (await ListAsync(token)).ShouldBeEmpty();
    }

    [Fact]
    public async Task whenPurchaseTriaged_ResolvePurchase_ShouldMoveItToDoneOnce()
    {
        Fixture.Factory.Clock.Set(Now);
        var token = await RegisterAsync("triage@example.test");
        var item = await CaptureAsync(token, Capture("tap-1"), HttpStatusCode.Created);
        var id = item.GetProperty("id").GetString()!;
        var path = $"/api/purchase-inbox/{id}/resolve";

        var (status, error) = await SendAsync(
            HttpMethod.Post,
            path,
            token,
            new { outcome = "added" }
        );
        status.ShouldBe(HttpStatusCode.BadRequest, "added needs the entry");
        Code(error).ShouldBe(ErrorCodes.PurchaseInboxInvalidResolution);
        (status, error) = await SendAsync(
            HttpMethod.Post,
            path,
            token,
            new { outcome = "discarded", entryId = "e1" }
        );
        status.ShouldBe(HttpStatusCode.BadRequest);
        (status, error) = await SendAsync(
            HttpMethod.Post,
            path,
            token,
            new { outcome = "kept", entryId = "e1" }
        );
        status.ShouldBe(HttpStatusCode.BadRequest);

        Fixture.Factory.Clock.Set(Now.AddMinutes(1));
        var (added, done) = await SendAsync(
            HttpMethod.Post,
            path,
            token,
            new
            {
                outcome = "added",
                entryId = "entry-1",
                householdId = "home-1",
            }
        );
        added.ShouldBe(HttpStatusCode.OK, done.ToString());
        done.GetProperty("status").GetString().ShouldBe("done");
        done.GetProperty("outcome").GetString().ShouldBe("added");
        done.GetProperty("entryId").GetString().ShouldBe("entry-1");
        done.GetProperty("householdId").GetString().ShouldBe("home-1");
        done.GetProperty("resolvedAt")
            .GetInt64()
            .ShouldBe(Now.AddMinutes(1).ToUnixTimeMilliseconds());

        // A retry of the same triage succeeds; another device's different triage loses.
        (status, _) = await SendAsync(
            HttpMethod.Post,
            path,
            token,
            new
            {
                outcome = "added",
                entryId = "entry-1",
                householdId = "home-1",
            }
        );
        status.ShouldBe(HttpStatusCode.OK);
        (status, error) = await SendAsync(
            HttpMethod.Post,
            path,
            token,
            new { outcome = "discarded" }
        );
        status.ShouldBe(HttpStatusCode.Conflict);
        Code(error).ShouldBe(ErrorCodes.PurchaseInboxAlreadyDone);

        (await ListAsync(token)).ShouldBeEmpty();
        (await ListAsync(token, "done")).Single().GetProperty("id").GetString().ShouldBe(id);

        // Undo brings it back as it was captured.
        var (reopened, back) = await SendAsync(
            HttpMethod.Post,
            $"/api/purchase-inbox/{id}/reopen",
            token
        );
        reopened.ShouldBe(HttpStatusCode.OK);
        back.GetProperty("status").GetString().ShouldBe("to_review");
        back.GetProperty("entryId").ValueKind.ShouldBe(JsonValueKind.Null);
        back.GetProperty("resolvedAt").ValueKind.ShouldBe(JsonValueKind.Null);
        (await ListAsync(token)).Single().GetProperty("id").GetString().ShouldBe(id);
        (await ListAsync(token, "done")).ShouldBeEmpty();

        (status, done) = await SendAsync(
            HttpMethod.Post,
            path,
            token,
            new { outcome = "discarded" }
        );
        status.ShouldBe(HttpStatusCode.OK);
        done.GetProperty("outcome").GetString().ShouldBe("discarded");
    }

    [Fact]
    public async Task whenAnotherUsersPurchase_EveryOperation_ShouldReturnNotFound()
    {
        Fixture.Factory.Clock.Set(Now);
        var owner = await RegisterAsync("owner@example.test");
        var other = await RegisterAsync("other@example.test");
        var id = (await CaptureAsync(owner, Capture("tap-1"), HttpStatusCode.Created))
            .GetProperty("id")
            .GetString()!;

        (await ListAsync(other)).ShouldBeEmpty();
        var (status, error) = await SendAsync(
            HttpMethod.Post,
            $"/api/purchase-inbox/{id}/resolve",
            other,
            new { outcome = "discarded" }
        );
        status.ShouldBe(HttpStatusCode.NotFound);
        Code(error).ShouldBe(ErrorCodes.PurchaseInboxNotFound);
        (status, _) = await SendAsync(HttpMethod.Post, $"/api/purchase-inbox/{id}/reopen", other);
        status.ShouldBe(HttpStatusCode.NotFound);
        (status, _) = await SendAsync(
            HttpMethod.Post,
            "/api/purchase-inbox/not-an-id/reopen",
            owner
        );
        status.ShouldBe(HttpStatusCode.NotFound);

        // The same key is per user: another person's tap is a new item.
        var theirs = await CaptureAsync(other, Capture("tap-1"), HttpStatusCode.Created);
        theirs.GetProperty("id").GetString().ShouldNotBe(id);
        (await ListAsync(owner)).Single().GetProperty("id").GetString().ShouldBe(id);
    }

    [Fact]
    public async Task whenStatusFilterUnknown_ListPurchases_ShouldReturnBadRequest()
    {
        var token = await RegisterAsync("filter@example.test");
        var (status, error) = await SendAsync(
            HttpMethod.Get,
            "/api/purchase-inbox?status=all",
            token
        );
        status.ShouldBe(HttpStatusCode.BadRequest);
        Code(error).ShouldBe(ErrorCodes.PurchaseInboxInvalidFilter);
    }

    [Fact]
    public async Task whenDoneMonthOld_CapturePurchase_ShouldForgetOldTriage()
    {
        Fixture.Factory.Clock.Set(Now);
        var token = await RegisterAsync("forget@example.test");
        var old = (await CaptureAsync(token, Capture("tap-old"), HttpStatusCode.Created))
            .GetProperty("id")
            .GetString()!;
        await SendAsync(
            HttpMethod.Post,
            $"/api/purchase-inbox/{old}/resolve",
            token,
            new { outcome = "discarded" }
        );
        (await ListAsync(token, "done")).Count.ShouldBe(1);

        // A month later (moved on the row: a month would also expire the session).
        await Fixture.SqlAsync(
            "UPDATE penny.captured_purchases SET resolved_at = resolved_at - interval '31 days'",
            Ct
        );
        (await ListAsync(token, "done")).ShouldBeEmpty("Done lists the last 30 days");
        await CaptureAsync(token, Capture("tap-new"), HttpStatusCode.Created);
        var (status, _) = await SendAsync(
            HttpMethod.Post,
            $"/api/purchase-inbox/{old}/reopen",
            token
        );
        status.ShouldBe(HttpStatusCode.NotFound, "an old done item is deleted by the next capture");
    }

    [Fact]
    public async Task whenCardsReplaced_CardMapping_ShouldReturnTheWholeListByName()
    {
        var token = await RegisterAsync("cards@example.test");
        var (status, empty) = await SendAsync(HttpMethod.Get, "/api/purchase-inbox/cards", token);
        status.ShouldBe(HttpStatusCode.OK);
        empty.GetProperty("cards").GetArrayLength().ShouldBe(0);

        var (saved, cards) = await SendAsync(
            HttpMethod.Put,
            "/api/purchase-inbox/cards",
            token,
            new
            {
                cards = new[]
                {
                    new { card = "Visa 0001", accountId = "acct-visa" },
                    new { card = " amex 0002 ", accountId = "acct-amex" },
                },
            }
        );
        saved.ShouldBe(HttpStatusCode.OK, cards.ToString());
        cards
            .GetProperty("cards")
            .EnumerateArray()
            .Select(card => card.GetProperty("card").GetString())
            .ShouldBe(["amex 0002", "Visa 0001"]);

        (saved, cards) = await SendAsync(
            HttpMethod.Put,
            "/api/purchase-inbox/cards",
            token,
            new { cards = new[] { new { card = "Visa 0001", accountId = "acct-chequing" } } }
        );
        saved.ShouldBe(HttpStatusCode.OK);
        var single = cards.GetProperty("cards").EnumerateArray().Single();
        single.GetProperty("accountId").GetString().ShouldBe("acct-chequing");

        foreach (
            var body in new object[]
            {
                new
                {
                    cards = new[]
                    {
                        new { card = "Visa", accountId = "a" },
                        new { card = "VISA", accountId = "b" },
                    },
                },
                new { cards = new[] { new { card = "", accountId = "a" } } },
                new { cards = new[] { new { card = "Visa", accountId = "" } } },
                new
                {
                    cards = Enumerable
                        .Range(0, 51)
                        .Select(index => new { card = $"Card {index}", accountId = "a" })
                        .ToArray(),
                },
                new { list = Array.Empty<object>() },
            }
        )
        {
            var (refused, error) = await SendAsync(
                HttpMethod.Put,
                "/api/purchase-inbox/cards",
                token,
                body
            );
            refused.ShouldBe(HttpStatusCode.BadRequest);
            Code(error).ShouldBe(ErrorCodes.PurchaseInboxInvalidCards);
        }
        var (_, after) = await SendAsync(HttpMethod.Get, "/api/purchase-inbox/cards", token);
        after.GetProperty("cards").GetArrayLength().ShouldBe(1, "a refused list changes nothing");
    }
}
