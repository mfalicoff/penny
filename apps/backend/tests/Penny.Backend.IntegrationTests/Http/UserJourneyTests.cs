using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Application.Push;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Repositories;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Http;

// The MAZ-64 release journey: one continuous flow through real HTTP and PostgreSQL
// covering OIDC and password registration, a receipt-backed ledger write, a two-user
// household and shared trip, a shared expense, a recurring rule run by the worker,
// push delivery, monthly settlement and an API restart that must reproduce every
// result from the database alone. Every step depends on the previous one, so a
// regression anywhere in the chain fails here even when the feature suites pass.
// Accounts, tokens and amounts are synthetic.
public sealed class UserJourneyTests(ApiFixture fixture, FakeOidcProvider provider)
    : SharedRecurrenceTestBase(fixture),
        IClassFixture<FakeOidcProvider>
{
    private const string AlexEmail = "alex.journey@example.test";
    private const string SamEmail = "sam.journey@example.test";

    // A synthetic 32-byte APNs device token.
    private const string SamDevice =
        "5a5b5c5d5e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9";

    [Fact]
    public async Task whenTwoUsersShareAMonth_ReleaseJourney_ShouldSurviveRestartIntact()
    {
        provider.Reset();
        At(Noon);

        // 1. Registration: alex through OIDC on a provider-trusting host, sam by password.
        string alexToken;
        await using (var oidcHost = provider.CreateApi(Fixture.RuntimeConnection))
        {
            oidcHost.Clock.Set(Noon);
            using var oidcClient = CreateClient(oidcHost);
            alexToken = await OidcSignInAsync(oidcClient);
        }
        var alexId = (string)
            (await ScalarAsync($"SELECT id FROM penny.users WHERE email = '{AlexEmail}'"))!;
        var sam = await AccountAsync(SamEmail);
        (await MeAsync(Client, alexToken)).ShouldBe(AlexEmail);

        // 2. Ledger with an uploaded receipt; stored metadata replaces client text.
        var receiptBytes = SyntheticPdf();
        var receiptId = await UploadReceiptAsync(alexToken, receiptBytes);
        var ledger = await GetLedgerAsync(alexToken);
        ledger["ledger"]!["transactions"]!.AsArray().Add(Entry(receiptId));
        using (var saved = await PutLedgerAsync(alexToken, ledger))
            saved.StatusCode.ShouldBe(HttpStatusCode.OK);

        // 3. Household and shared trip with both members; devices for notifications.
        var home = Id(await CreateHouseholdAsync(alexToken, "Journey home"));
        await AdmitAsync(home, alexToken, sam.Token);
        var trip = Id(await CreateTripAsync(alexToken));
        await AdmitAsync(trip, alexToken, sam.Token);
        (await ListIdsAsync(sam.Token)).Order().ShouldBe(new[] { home, trip }.Order());
        await ExpectAsync(
            HttpMethod.Post,
            "/api/push/devices",
            sam.Token,
            HttpStatusCode.Created,
            new
            {
                token = SamDevice,
                platform = "ios",
                provider = "apns",
                environment = "production",
            }
        );

        // 4. A shared expense alex pays, split equally; the push worker's next pass
        // notifies sam's device (never alex, the actor) with a deep link to it.
        var apns = new FakePushTransport(PushProviders.Apns);
        var groceries = await CreateExpenseAsync(home, alexToken, Expense(10000, alexId));
        await PushRunner(apns).RunUntilIdleAsync(Ct);
        var notified = (await apns.SentToAsync(SamDevice)).Single();
        notified.Title.ShouldBe("New household expense");
        notified.Payload.HouseholdId.ShouldBe(home);
        notified.Payload.ExpenseId.ShouldBe(Id(groceries));

        // 5. A monthly rule sam pays; the worker records the occurrence on its due day.
        var rule = await CreateRuleAsync(home, sam.Token, Rule(200000, sam.UserId, "2026-09-29"));
        (await RunAtAsync(Utc("2026-09-29", 9))).ShouldBe(1);
        (await NextDateAsync(Id(rule))).ShouldBe("2026-10-29");
        (await ProjectionAsync(sam.Token, "?month=2026-09"))
            .GetProperty("transactions")
            .GetArrayLength()
            .ShouldBe(2);

        // 6. Monthly settlement: alex owes sam 1,000.00 - 50.00, then pays exactly that.
        At(Utc("2026-09-30", 9));
        var recap = await SettlementRecapAsync(home, alexToken);
        Suggestions(recap).ShouldBe([(alexId, sam.UserId, 95000L)]);
        await ExpectAsync(
            HttpMethod.Post,
            $"/api/households/{home}/months/2026-09/reimbursements",
            alexToken,
            HttpStatusCode.Created,
            new
            {
                fromUserId = alexId,
                toUserId = sam.UserId,
                amountCents = 95000,
            }
        );

        // 7. The reimbursement reaches sam too; nothing is left in the outbox.
        await PushRunner(apns).RunUntilIdleAsync(Ct);
        (await apns.SentToAsync(SamDevice))
            .Select(message => message.Title)
            .ShouldContain("Reimbursement recorded");
        apns.Sent.ShouldAllBe(message => message.Token == SamDevice);
        (await CountAsync("SELECT count(*) FROM penny.push_outbox WHERE sent_at IS NULL")).ShouldBe(
            0L
        );

        // 8. Restart: a new host over the same database must reproduce all of it.
        await using var restarted = new TestApiFactory(
            Fixture.RuntimeConnection,
            new Dictionary<string, string>
            {
                ["Receipts:Root"] = Fixture.ReceiptRoot,
                ["Receipts:MasterKey"] = Fixture.ReceiptKey,
            }
        );
        restarted.Clock.Set(Utc("2026-09-30", 10));
        using var after = CreateClient(restarted);

        (await MeAsync(after, alexToken)).ShouldBe(AlexEmail, "sessions live in PostgreSQL");
        (await MeAsync(after, sam.Token)).ShouldBe(SamEmail);
        var reread = await ReadAsync(after, HttpMethod.Get, "/api/ledger", alexToken);
        var entry = reread
            .GetProperty("ledger")
            .GetProperty("transactions")
            .EnumerateArray()
            .Single();
        entry
            .GetProperty("receipt")
            .GetProperty("uri")
            .GetString()
            .ShouldBe("/api/receipts/" + receiptId);
        using (
            var download = await after.SendAsync(
                Authorized(HttpMethod.Get, "/api/receipts/" + receiptId, bearer: alexToken),
                Ct
            )
        )
        {
            download.StatusCode.ShouldBe(HttpStatusCode.OK);
            (await download.Content.ReadAsByteArrayAsync(Ct)).ShouldBe(receiptBytes);
        }
        using (
            var stolen = await after.SendAsync(
                Authorized(HttpMethod.Get, "/api/receipts/" + receiptId, bearer: sam.Token),
                Ct
            )
        )
            stolen.StatusCode.ShouldBe(HttpStatusCode.NotFound, "receipts stay private");

        var settled = await ReadAsync(
            after,
            HttpMethod.Get,
            $"/api/households/{home}/months/2026-09",
            sam.Token
        );
        Suggestions(settled).ShouldBeEmpty();
        settled.GetProperty("reimbursements").GetArrayLength().ShouldBe(1);
        var rules = await ReadAsync(
            after,
            HttpMethod.Get,
            $"/api/households/{home}/recurring",
            alexToken
        );
        rules
            .GetProperty("rules")
            .EnumerateArray()
            .Single()
            .GetProperty("nextDate")
            .GetString()
            .ShouldBe("2026-10-29");
        var members = (await ReadAsync(after, HttpMethod.Get, $"/api/households/{trip}", sam.Token))
            .GetProperty("members")
            .GetArrayLength();
        members.ShouldBe(2);

        // Nothing is redelivered after the restart.
        (await PushRunner(apns).RunOnceAsync(Ct)).Claimed.ShouldBe(0);

        // Logging out on the new host revokes the session everywhere.
        using (
            var logout = await after.SendAsync(
                Authorized(HttpMethod.Post, "/api/auth/logout", bearer: sam.Token),
                Ct
            )
        )
            logout.StatusCode.ShouldBe(HttpStatusCode.OK);
        using (
            var revoked = await Client.SendAsync(
                Authorized(HttpMethod.Get, "/api/auth/me", bearer: sam.Token),
                Ct
            )
        )
            revoked.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    private async Task<string> OidcSignInAsync(HttpClient client)
    {
        using var started = await client.PostAsJsonAsync(
            "/api/auth/oidc/start",
            new { redirectUri = FakeOidcProvider.WebRedirect },
            Ct
        );
        started.StatusCode.ShouldBe(HttpStatusCode.OK);
        var challenge = await started.Content.ReadFromJsonAsync<JsonElement>(Ct);
        var callbackUrl = provider.Authorize(
            challenge.GetProperty("authorizationUrl").GetString()!,
            new FakeOidcGrant { Subject = "journey-alex", Email = AlexEmail }
        );
        using var completed = await client.PostAsJsonAsync(
            "/api/auth/oidc/complete",
            new { transaction = challenge.GetProperty("transaction").GetString(), callbackUrl },
            Ct
        );
        completed.StatusCode.ShouldBe(HttpStatusCode.OK);
        var session = (await completed.Content.ReadFromJsonAsync<SessionResponse>(Ct))!;
        session.Email.ShouldBe(AlexEmail);
        return session.Token;
    }

    private async Task<string> UploadReceiptAsync(string token, byte[] content)
    {
        var receipt = await ExpectAsync(
            HttpMethod.Post,
            "/api/receipts",
            token,
            HttpStatusCode.Created,
            new
            {
                name = "Groceries.pdf",
                mime = "application/pdf",
                base64 = Convert.ToBase64String(content),
            }
        );
        return Id(receipt);
    }

    private Task<JsonElement> SettlementRecapAsync(string householdId, string token) =>
        ExpectAsync(
            HttpMethod.Get,
            $"/api/households/{householdId}/months/2026-09",
            token,
            HttpStatusCode.OK
        );

    private PushDeliveryRunner PushRunner(params IPushTransport[] transports) =>
        new(
            new PostgresPushRepository(
                Fixture.Factory.Services.GetRequiredService<NpgsqlDataSource>()
            ),
            transports,
            Fixture.Factory.Clock
        );

    private static async Task<string> MeAsync(HttpClient client, string token)
    {
        var me = await ReadAsync(client, HttpMethod.Get, "/api/auth/me", token);
        return me.GetProperty("email").GetString()!;
    }

    private static async Task<JsonElement> ReadAsync(
        HttpClient client,
        HttpMethod method,
        string path,
        string token
    )
    {
        using var response = await client.SendAsync(Authorized(method, path, bearer: token), Ct);
        var text = await response.Content.ReadAsStringAsync(Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, text);
        return JsonDocument.Parse(text).RootElement.Clone();
    }

    private static List<(string From, string To, long Cents)> Suggestions(JsonElement recap) =>
        [
            .. recap
                .GetProperty("suggestions")
                .EnumerateArray()
                .Select(suggestion =>
                    (
                        suggestion.GetProperty("fromUserId").GetString()!,
                        suggestion.GetProperty("toUserId").GetString()!,
                        suggestion.GetProperty("amountCents").GetInt64()
                    )
                ),
        ];

    private static byte[] SyntheticPdf()
    {
        var content = new byte[2048];
        "%PDF-1.7\n"u8.CopyTo(content);
        return content;
    }

    private static JsonObject Entry(string receiptId) =>
        new()
        {
            ["id"] = "journey-groceries",
            ["title"] = "Synthetic groceries",
            ["kind"] = "expense",
            ["total"] = 4200,
            ["share"] = 4200,
            ["categoryId"] = "food",
            ["date"] = "2026-09-28",
            ["note"] = "",
            ["receipt"] = new JsonObject
            {
                ["id"] = receiptId,
                ["name"] = "client-chosen.pdf",
                ["mime"] = "image/png",
                ["uri"] = "file:///synthetic",
            },
        };
}
