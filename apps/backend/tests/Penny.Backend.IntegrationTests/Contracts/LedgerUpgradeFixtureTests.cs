using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Contracts;

// MAZ-64: supported old clients. Every case of contracts/fixtures/ledger-upgrades.json
// (ledger v1, v2, v3 and v4 bodies, as the legacy app versions wrote them) is sent as a
// first write over real HTTP and PostgreSQL. The response and a later read must be the
// legacy upgrade output, the stored revision advances once, and the stored document is
// always v4. The unit suite checks the same cases against LedgerReader in process.
public sealed class LedgerUpgradeFixtureTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    // Ledger lists have no stored position; .NET reads them by id
    // (docs/migration/ledger.md#storage-mapping-and-read-order).
    private static readonly string[] UnorderedLists =
    [
        "accounts",
        "trips",
        "categories",
        "recurring",
        "transactions",
    ];

    public static TheoryData<string> Cases()
    {
        var names = new TheoryData<string>();
        foreach (var item in ContractFixtures.Read("ledger-upgrades.json").AsArray())
            names.Add(item!["name"]!.GetValue<string>());
        return names;
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task whenOldClientWritesFixtureLedger_PutLedger_ShouldStoreLegacyUpgrade(
        string name
    )
    {
        var item = ContractFixtures
            .Read("ledger-upgrades.json")
            .AsArray()
            .Single(entry => entry!["name"]!.GetValue<string>() == name)!;
        var token = await RegisterAsync($"{name}@example.test");

        using var write = Authorized(HttpMethod.Put, "/api/ledger", bearer: token);
        write.Content = JsonContent.Create(
            new JsonObject { ["revision"] = 0, ["ledger"] = item["input"]!.DeepClone() }
        );
        using var saved = await Client.SendAsync(write, Ct);
        var text = await saved.Content.ReadAsStringAsync(Ct);
        saved.StatusCode.ShouldBe(HttpStatusCode.OK, text);
        var response = JsonNode.Parse(text)!;
        response["revision"]!.GetValue<long>().ShouldBe(1);
        ShouldEqualIgnoringListOrder(response["ledger"]!, item["expected"]!, name);

        using var read = await Client.SendAsync(
            Authorized(HttpMethod.Get, "/api/ledger", bearer: token),
            Ct
        );
        read.StatusCode.ShouldBe(HttpStatusCode.OK);
        var reread = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
        reread["revision"]!.GetValue<long>().ShouldBe(1);
        reread["ledger"]!["version"]!.GetValue<int>().ShouldBe(4, "storage is always v4");
        ShouldEqualIgnoringListOrder(reread["ledger"]!, item["expected"]!, name);
    }

    [Fact]
    public async Task whenClientSendsUnknownFutureVersion_PutLedger_ShouldRefuseWithoutWriting()
    {
        var token = await RegisterAsync("future@example.test");
        var item = ContractFixtures.Read("ledger-upgrades.json").AsArray().Last()!;
        var ledger = item["input"]!.DeepClone();
        ledger["version"] = 5;
        using var write = Authorized(HttpMethod.Put, "/api/ledger", bearer: token);
        write.Content = JsonContent.Create(
            new JsonObject { ["revision"] = 0, ["ledger"] = ledger }
        );
        using var refused = await Client.SendAsync(write, Ct);
        refused.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        using var read = await Client.SendAsync(
            Authorized(HttpMethod.Get, "/api/ledger", bearer: token),
            Ct
        );
        JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!["revision"]!
            .GetValue<long>()
            .ShouldBe(0);
    }

    private static void ShouldEqualIgnoringListOrder(
        JsonNode actual,
        JsonNode expected,
        string name
    )
    {
        var left = Ordered(actual);
        var right = Ordered(expected);
        JsonNode
            .DeepEquals(left, right)
            .ShouldBeTrue($"{name}: {left.ToJsonString()} != {right.ToJsonString()}");
    }

    private static JsonObject Ordered(JsonNode ledger)
    {
        var copy = ledger.DeepClone().AsObject();
        foreach (var list in UnorderedLists)
            if (copy[list] is JsonArray items)
                copy[list] = new JsonArray([
                    .. items
                        .OrderBy(entry => entry!["id"]!.GetValue<string>(), StringComparer.Ordinal)
                        .Select(entry => entry!.DeepClone()),
                ]);
        return copy;
    }
}
