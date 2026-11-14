using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Migrations;
using Penny.Backend.Persistence.Schema;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Migrations;

// MAZ-64 schema upgrades on populated databases. For every earlier migration, a
// database holding real product data at that schema is upgraded the way a release
// does it: `DatabaseMigrator` (the `migrate` command), runtime grants, then
// `search-rebuild` where the documented upgrade needs it. A new API host must then
// read and write everything written before the upgrade.
//
// The older database is built by writing data through the current API and running
// the EF down migrations to the target. Down migrations only remove what later
// migrations added (tables and columns), so what remains is exactly the data an
// older release could hold. They are a fixture device here: production recovery is
// forward-only (docs/reference/postgresql.md).
public sealed class PopulatedUpgradeTests(ApiFixture fixture) : SharedRecurrenceTestBase(fixture)
{
    public static TheoryData<string> EarlierMigrations()
    {
        using var context = PennyDbContext.Create(
            Npgsql.NpgsqlDataSource.Create("Host=unused;Database=unused")
        );
        var migrations = context.Database.GetMigrations().ToList();
        var data = new TheoryData<string>();
        foreach (var migration in migrations[..^1])
            data.Add(migration);
        return data;
    }

    // The squashed history has one migration, so there is nothing earlier to upgrade
    // from yet; each migration added after it gets a case here automatically.
    [Theory(SkipTestWithoutData = true)]
    [MemberData(nameof(EarlierMigrations))]
    public async Task whenPopulatedDatabaseAtEarlierMigration_Migrate_ShouldKeepEveryRecordUsable(
        string target
    )
    {
        // Product data written through HTTP: accounts and sessions, a personal ledger
        // entry, a household with a shared expense and rule, a receipt and an APNs device.
        At(Noon);
        var alex = await AccountAsync("alex.upgrade@example.test");
        var sam = await AccountAsync("sam.upgrade@example.test");
        await SaveEntryAsync(alex.Token, "upgrade-bakery", "Boulangerie du coin");
        var home = Id(await CreateHouseholdAsync(alex.Token, "Upgrade home"));
        await AdmitAsync(home, alex.Token, sam.Token);
        var expense = await CreateExpenseAsync(
            home,
            alex.Token,
            Expense(4200, alex.UserId, extra: new { title = "Fromagerie" })
        );
        var rule = await CreateRuleAsync(home, sam.Token, Rule(90000, sam.UserId, "2026-10-01"));
        var receipt = await ExpectAsync(
            HttpMethod.Post,
            "/api/receipts",
            alex.Token,
            HttpStatusCode.Created,
            new
            {
                name = "Upgrade.pdf",
                mime = "application/pdf",
                base64 = Convert.ToBase64String("%PDF-1.7\nupgrade"u8.ToArray()),
            }
        );
        await ExpectAsync(
            HttpMethod.Post,
            "/api/push/devices",
            sam.Token,
            HttpStatusCode.Created,
            new
            {
                token = Convert.ToHexStringLower(new byte[32]),
                platform = "ios",
                provider = "apns",
                environment = "production",
            }
        );

        // Back to the earlier schema, then the release upgrade path.
        await using (var context = PennyDbContext.Create(Fixture.Admin))
            await context.GetService<IMigrator>().MigrateAsync(target, Ct);
        await using (var context = PennyDbContext.Create(Fixture.Admin))
            (await context.Database.GetAppliedMigrationsAsync(Ct)).Last().ShouldBe(target);
        await DatabaseMigrator.ApplyAsync(Fixture.Admin, Ct);
        await Fixture.GrantRuntimeAsync(Ct);
        await RebuildSearchAsync();

        // A new host (the upgraded release) over the upgraded database.
        await using var upgraded = new TestApiFactory(
            Fixture.RuntimeConnection,
            new Dictionary<string, string>
            {
                ["Receipts:Root"] = Fixture.ReceiptRoot,
                ["Receipts:MasterKey"] = Fixture.ReceiptKey,
            }
        );
        upgraded.Clock.Set(Noon.AddHours(1));
        using var client = CreateClient(upgraded);

        // Readiness checks the schema, extensions and grants without changing data.
        await ReadAsync(client, "/api/ready", null);
        (await ReadAsync(client, "/api/auth/me", sam.Token))
            .GetProperty("email")
            .GetString()
            .ShouldBe("sam.upgrade@example.test");
        var ledger = await ReadAsync(client, "/api/ledger", alex.Token);
        ledger
            .GetProperty("ledger")
            .GetProperty("transactions")
            .EnumerateArray()
            .Select(entry => entry.GetProperty("id").GetString())
            .ShouldBe(["upgrade-bakery"]);
        (await ReadAsync(client, $"/api/households/{home}", sam.Token))
            .GetProperty("members")
            .GetArrayLength()
            .ShouldBe(2);
        (await ReadAsync(client, $"/api/households/{home}/expenses/{Id(expense)}", sam.Token))
            .GetProperty("expense")
            .GetProperty("totalCents")
            .GetInt64()
            .ShouldBe(4200);
        (await ReadAsync(client, $"/api/households/{home}/recurring", alex.Token))
            .GetProperty("rules")
            .EnumerateArray()
            .Single()
            .GetProperty("id")
            .GetString()
            .ShouldBe(Id(rule));
        using (
            var download = await client.SendAsync(
                Authorized(HttpMethod.Get, "/api/receipts/" + Id(receipt), bearer: alex.Token),
                Ct
            )
        )
            download.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await ScalarAsync("SELECT provider FROM penny.push_devices")).ShouldBe("apns");

        // Data written before search existed is searchable after the documented rebuild.
        var personal = await SearchAsync(client, alex.Token, "boulangerie");
        personal.ShouldContain("personal:upgrade-bakery");
        var shared = await SearchAsync(client, sam.Token, "fromagerie");
        shared.ShouldContain("shared:" + Id(expense));

        // And the upgraded database accepts writes.
        await SaveEntryAsync(alex.Token, "upgrade-after", "Marché", client);
        using (
            var created = await client.SendAsync(
                WithBody(
                    Authorized(
                        HttpMethod.Post,
                        $"/api/households/{home}/expenses",
                        bearer: sam.Token
                    ),
                    Expense(1000, sam.UserId, extra: new { title = "After upgrade" })
                ),
                Ct
            )
        )
            created.StatusCode.ShouldBe(HttpStatusCode.Created);
    }

    private async Task RebuildSearchAsync()
    {
        var (exit, output, error) = await MaintenanceProcess.RunAsync(
            null,
            ["search-rebuild"],
            Ct,
            new Dictionary<string, string>
            {
                ["ConnectionStrings__Postgres"] = Fixture.RuntimeConnection,
                ["Receipts__Root"] = Fixture.ReceiptRoot,
                ["Receipts__MasterKey"] = Fixture.ReceiptKey,
                ["Search__ModelDirectory"] = SearchModel.Directory,
            }
        );
        exit.ShouldBe(0, error + output);
    }

    private async Task SaveEntryAsync(
        string token,
        string id,
        string title,
        HttpClient? client = null
    )
    {
        var target = client ?? Client;
        var snapshot = JsonNode.Parse(
            (await ReadAsync(target, "/api/ledger", token)).GetRawText()
        )!;
        snapshot["ledger"]!["transactions"]!
            .AsArray()
            .Add(
                new JsonObject
                {
                    ["id"] = id,
                    ["title"] = title,
                    ["kind"] = "expense",
                    ["total"] = 1500,
                    ["share"] = 1500,
                    ["categoryId"] = "food",
                    ["date"] = "2026-09-28",
                    ["note"] = "",
                }
            );
        using var saved = await target.SendAsync(
            WithBody(Authorized(HttpMethod.Put, "/api/ledger", bearer: token), snapshot),
            Ct
        );
        saved.StatusCode.ShouldBe(HttpStatusCode.OK, await saved.Content.ReadAsStringAsync(Ct));
    }

    private static HttpRequestMessage WithBody(HttpRequestMessage request, object body)
    {
        request.Content = System.Net.Http.Json.JsonContent.Create(body);
        return request;
    }

    private static async Task<List<string>> SearchAsync(
        HttpClient client,
        string token,
        string query
    )
    {
        using var response = await client.SendAsync(
            WithBody(
                Authorized(HttpMethod.Post, "/api/v1/search/transactions", bearer: token),
                new { query }
            ),
            Ct
        );
        var text = await response.Content.ReadAsStringAsync(Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, text);
        return
        [
            .. JsonDocument
                .Parse(text)
                .RootElement.GetProperty("items")
                .EnumerateArray()
                .Select(item => item.GetProperty("key").GetString()!),
        ];
    }

    private static async Task<JsonElement> ReadAsync(HttpClient client, string path, string? token)
    {
        using var response = await client.SendAsync(
            Authorized(HttpMethod.Get, path, bearer: token),
            Ct
        );
        var text = await response.Content.ReadAsStringAsync(Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, text);
        return JsonDocument.Parse(text).RootElement.Clone();
    }
}
