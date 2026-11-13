using System.Net;
using System.Text.Json;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Search authorization over shared expenses (household-view rules) and personal
// entries, evaluated in SQL before matching, counting and paging. No embeddings are
// computed here, so every assertion is about lexical tiers.
public sealed class SearchAccessTests(ApiFixture fixture) : SearchTestBase(fixture)
{
    private static JsonElement Item(JsonElement page, string key) =>
        page.GetProperty("items")
            .EnumerateArray()
            .Single(item => item.GetProperty("key").GetString() == key);

    [Fact]
    public async Task whenMembersSearch_Search_ShouldApplyHouseholdVisibilityAndShares()
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        var (outsider, _) = await AccountAsync("outsider@example.test");
        At(Noon);
        var home = Id(await CreateHouseholdAsync(alex));
        At(Noon.AddDays(5));
        await AdmitAsync(home, alex, bea);
        var shared = Id(
            await CreateExpenseAsync(
                home,
                alex,
                Expense(1000, alexId, "2026-10-03", new { title = "Pizza night", note = "Friday" })
            )
        );
        // Alex alone has a share; Bea still sees it as a current member, share 0.
        var solo = Id(
            await CreateExpenseAsync(
                home,
                alex,
                // Dated before Bea joined: only Alex was eligible.
                Expense(700, alexId, "2026-09-29", new { title = "Pizza oven" })
            )
        );

        var beaPage = await SearchAsync(bea, new { query = "pizza" });
        Keys(beaPage).ShouldBe(["shared:" + shared, "shared:" + solo]);
        Total(beaPage).ShouldBe(2);
        var item = Item(beaPage, "shared:" + shared);
        item.GetProperty("source").GetString().ShouldBe("shared");
        item.GetProperty("match").GetString().ShouldBe("title");
        var entry = item.GetProperty("entry");
        entry.GetProperty("id").GetString().ShouldBe(shared);
        entry.GetProperty("householdName").GetString().ShouldBe("Home");
        entry.GetProperty("totalCents").GetInt64().ShouldBe(1000);
        entry.GetProperty("shareCents").GetInt64().ShouldBe(500);
        Item(beaPage, "shared:" + solo)
            .GetProperty("entry")
            .GetProperty("shareCents")
            .GetInt64()
            .ShouldBe(0);
        // Amount sorts use the viewer's share.
        Keys(await SearchAsync(bea, new { query = "pizza", sort = "amount-asc" }))
            .ShouldBe(["shared:" + solo, "shared:" + shared]);
        Keys(await SearchAsync(alex, new { query = "pizza", sort = "amount-asc" }))
            .ShouldBe(["shared:" + shared, "shared:" + solo]);

        // A non-member sees nothing and the count reveals nothing.
        var hidden = await SearchAsync(outsider, new { query = "pizza" });
        Keys(hidden).ShouldBeEmpty();
        Total(hidden).ShouldBe(0);
        Total(await SearchAsync(outsider, new { })).ShouldBe(0);
        // Source and kind filters.
        Keys(await SearchAsync(bea, new { query = "pizza", source = "personal" })).ShouldBeEmpty();
        Keys(await SearchAsync(bea, new { query = "pizza", kind = "income" })).ShouldBeEmpty();
        Total(await SearchAsync(bea, new { query = "friday", source = "shared" })).ShouldBe(1);
    }

    [Fact]
    public async Task whenPayerHasAccount_Search_ShouldMatchItsNameOnlyForThePayer()
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, _) = await AccountAsync("bea@example.test");
        At(Noon);
        var home = Id(await CreateHouseholdAsync(alex));
        await AdmitAsync(home, alex, bea);
        await AddAccountAsync(alex, "acct");
        var expense = Id(
            await CreateExpenseAsync(
                home,
                alex,
                Expense(1000, alexId, extra: new { title = "Dinner", accountId = "acct" })
            )
        );

        var payer = await SearchAsync(alex, new { query = "checking" });
        Keys(payer).ShouldBe(["shared:" + expense]);
        Matches(payer).ShouldBe(["text"]);
        Item(payer, "shared:" + expense)
            .GetProperty("entry")
            .GetProperty("accountId")
            .GetString()
            .ShouldBe("acct");
        var other = await SearchAsync(bea, new { query = "checking" });
        Keys(other).ShouldBeEmpty();
        Total(other).ShouldBe(0);
        Item(await SearchAsync(bea, new { query = "dinner" }), "shared:" + expense)
            .GetProperty("entry")
            .TryGetProperty("accountId", out _)
            .ShouldBeFalse();

        // An account rename rewrites the payer's document in the ledger transaction.
        await SaveLedgerAsync(alex, ledger => ledger["accounts"]![0]!["name"] = "Joint savings");
        Keys(await SearchAsync(alex, new { query = "checking" })).ShouldBeEmpty();
        Keys(await SearchAsync(alex, new { query = "joint savings" }))
            .ShouldBe(["shared:" + expense]);
        Keys(await SearchAsync(bea, new { query = "joint savings" })).ShouldBeEmpty();
    }

    [Fact]
    public async Task whenMemberLeaves_Search_ShouldKeepOnlyTheirSharesFromTheNextRequest()
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        At(Noon);
        var home = Id(await CreateHouseholdAsync(alex));
        At(Noon.AddDays(5));
        await AdmitAsync(home, alex, bea);
        var withBea = Id(
            await CreateExpenseAsync(
                home,
                alex,
                Expense(
                    9000,
                    alexId,
                    "2026-10-03",
                    new
                    {
                        title = "Taxi shared",
                        splitMode = "exact",
                        allocations = new[]
                        {
                            new { userId = alexId, amountCents = 9000 },
                            new { userId = beaId, amountCents = 0 },
                        },
                    }
                )
            )
        );
        var alexOnly = Id(
            await CreateExpenseAsync(
                home,
                alex,
                Expense(500, alexId, "2026-09-29", new { title = "Taxi solo" })
            )
        );
        Total(await SearchAsync(bea, new { query = "taxi" })).ShouldBe(2);

        await ExpectAsync(HttpMethod.Post, $"/api/households/{home}/leave", bea, HttpStatusCode.OK);
        var after = await SearchAsync(bea, new { query = "taxi" });
        Keys(after).ShouldBe(["shared:" + withBea]);
        Total(after).ShouldBe(1);
        var later = Id(
            await CreateExpenseAsync(
                home,
                alex,
                Expense(1200, alexId, "2026-10-05", new { title = "Taxi later" })
            )
        );
        Keys(await SearchAsync(bea, new { query = "taxi" })).ShouldBe(["shared:" + withBea]);
        Keys(await SearchAsync(alex, new { query = "taxi" }))
            .ShouldBe(["shared:" + later, "shared:" + withBea, "shared:" + alexOnly]);

        // Rejoining restores the current-member view.
        await AdmitAsync(home, alex, bea);
        Total(await SearchAsync(bea, new { query = "taxi" })).ShouldBe(3);
    }

    [Fact]
    public async Task whenExpenseDeletedOrMoved_Search_ShouldFollowItInTheSameTransaction()
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, _) = await AccountAsync("bea@example.test");
        At(Noon);
        var home = Id(await CreateHouseholdAsync(alex));
        var other = Id(await CreateHouseholdAsync(alex, "Cottage"));
        await AdmitAsync(home, alex, bea);
        var body = Expense(1000, alexId, extra: new { title = "Firewood" });
        var moving = await CreateExpenseAsync(home, alex, body);
        var deleting = await CreateExpenseAsync(
            home,
            alex,
            Expense(800, alexId, extra: new { title = "Firewood bundle" })
        );
        Total(await SearchAsync(bea, new { query = "firewood" })).ShouldBe(2);

        // Edit: the new title is searchable at once.
        await UpdateExpenseAsync(
            home,
            Id(moving),
            alex,
            WithRevision(Expense(1000, alexId, extra: new { title = "Kindling" }), 0)
        );
        Keys(await SearchAsync(bea, new { query = "kindling" })).ShouldBe(["shared:" + Id(moving)]);
        // Move to a household Bea is not in.
        await UpdateExpenseAsync(
            home,
            Id(moving),
            alex,
            WithRevision(Expense(1000, alexId, extra: new { title = "Kindling" }), 1, other)
        );
        Keys(await SearchAsync(bea, new { query = "kindling" })).ShouldBeEmpty();
        var moved = Item(
            await SearchAsync(alex, new { query = "kindling" }),
            "shared:" + Id(moving)
        );
        moved.GetProperty("entry").GetProperty("householdName").GetString().ShouldBe("Cottage");

        await ExpectAsync(
            HttpMethod.Delete,
            ExpensePath(home, Id(deleting)),
            alex,
            HttpStatusCode.OK,
            new { revision = 0 }
        );
        Keys(await SearchAsync(alex, new { query = "firewood" })).ShouldBeEmpty();
        (
            await CountAsync("SELECT count(*) FROM penny.search_documents WHERE source = 'shared'")
        ).ShouldBe(1);
    }

    [Fact]
    public async Task whenOtherUsersHaveEntries_Search_ShouldReturnOnlyTheViewersOwn()
    {
        var (alex, _) = await AccountAsync("alex@example.test");
        var (bea, _) = await AccountAsync("bea@example.test");
        await SeedLedgerAsync(alex);
        await SeedLedgerAsync(bea);
        var page = await SearchAsync(bea, new { query = "coffee", source = "personal" });
        Total(page).ShouldBe(3);
        Keys(page).ShouldBe(["personal:s01", "personal:s02", "personal:s04"]);
        Total(await SearchAsync(bea, new { })).ShouldBe(11);
        await SaveLedgerAsync(
            alex,
            ledger => ledger["transactions"] = new System.Text.Json.Nodes.JsonArray()
        );
        Total(await SearchAsync(alex, new { })).ShouldBe(0);
        Total(await SearchAsync(bea, new { })).ShouldBe(11);
    }
}
