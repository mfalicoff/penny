using System.Net;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Search documents follow ledger writes in the write transaction; embeddings follow
// through the outbox (drained explicitly here with the real model).
public sealed class SearchIndexingTests(ApiFixture fixture) : SearchTestBase(fixture)
{
    private static JsonObject Entry(string id, string title, string note = "") =>
        new()
        {
            ["id"] = id,
            ["title"] = title,
            ["date"] = "2026-11-04",
            ["kind"] = "expense",
            ["total"] = 300,
            ["share"] = 300,
            ["categoryId"] = "food",
            ["note"] = note,
        };

    [Fact]
    public async Task whenLedgerWriteRejected_Search_ShouldKeepTheCommittedDocuments()
    {
        var (token, _) = await AccountAsync("writer@example.test");
        await SeedLedgerAsync(token);
        var before = await CountAsync("SELECT count(*) FROM penny.search_documents");
        // A stale revision loses (409) and changes nothing.
        var snapshot = await GetLedgerAsync(token);
        snapshot["revision"] = 0;
        snapshot["ledger"]!["transactions"]!.AsArray().Add(Entry("z1", "Zebra crossing"));
        using (var stale = await PutLedgerAsync(token, snapshot))
            stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        // An invalid document (400) changes nothing either.
        var invalid = await GetLedgerAsync(token);
        invalid["ledger"]!["transactions"]!.AsArray().Add(Entry("z2", ""));
        using (var rejected = await PutLedgerAsync(token, invalid))
            rejected.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        Keys(await SearchAsync(token, new { query = "zebra" })).ShouldBeEmpty();
        (await CountAsync("SELECT count(*) FROM penny.search_documents")).ShouldBe(before);
    }

    [Fact]
    public async Task whenCategoryAndAccountRenamed_Search_ShouldRewriteAffectedDocuments()
    {
        var (token, _) = await AccountAsync("renamer@example.test");
        await SeedLedgerAsync(token);
        await CatchUpAsync();
        await SaveLedgerAsync(
            token,
            ledger =>
            {
                ledger["categories"]![0]!["name"] = "Nourriture";
                ledger["accounts"]![0]!["name"] = "Visa Voyage";
            }
        );
        var renamed = await SearchAsync(token, new { query = "nourriture" });
        Keys(renamed)
            .Take(5)
            .ShouldBe([
                "personal:s01",
                "personal:s02",
                "personal:s09",
                "personal:s03",
                "personal:s10",
            ]);
        Matches(renamed).Take(5).ShouldAllBe(match => match == "text");
        Matches(await SearchAsync(token, new { query = "food" })).ShouldNotContain("text");
        Keys(await SearchAsync(token, new { query = "visa voyage" })).ShouldBe(["personal:s01"]);
        Keys(await SearchAsync(token, new { query = "travel card" })).ShouldBeEmpty();
        // The category is embedded, so its five documents wait for new embeddings; the
        // account is not, so the rename alone queues nothing else.
        (
            await CountAsync(
                "SELECT count(*) FROM penny.search_documents WHERE embedding_due_at IS NOT NULL AND embedding IS NULL"
            )
        ).ShouldBe(5);
        (await CatchUpAsync()).ShouldBe(5);
    }

    [Fact]
    public async Task whenEntryWritten_Search_ShouldMatchTextAtOnceAndMeaningAfterCatchUp()
    {
        var (token, _) = await AccountAsync("fresh@example.test");
        await SeedLedgerAsync(token);
        await CatchUpAsync();
        await SaveLedgerAsync(
            token,
            ledger => ledger["transactions"]!.AsArray().Add(Entry("n1", "Espresso", "Double shot"))
        );
        var found = await SearchAsync(token, new { query = "espresso" });
        Keys(found)[0].ShouldBe("personal:n1");
        Matches(found)[0].ShouldBe("title");
        Keys(await SearchAsync(token, new { query = "beverage" })).ShouldNotContain("personal:n1");
        (
            await Fixture
                .Factory.Services.GetRequiredService<ISearchRepository>()
                .PendingEmbeddingsAsync(Ct)
        ).ShouldBe(1);
        (await CatchUpAsync()).ShouldBe(1);
        MatchOf(await SearchAsync(token, new { query = "beverage" }), "personal:n1")
            .ShouldBe("meaning");

        // An edit clears the stale vector until the worker re-embeds it.
        await SaveLedgerAsync(
            token,
            ledger =>
                ledger["transactions"]!
                    .AsArray()
                    .Single(entry => entry!["id"]!.GetValue<string>() == "n1")!["title"] =
                    "Bike tire"
        );
        Keys(await SearchAsync(token, new { query = "beverage" })).ShouldNotContain("personal:n1");
        Keys(await SearchAsync(token, new { query = "espresso" })).ShouldNotContain("personal:n1");
        // A change that does not touch the embedded text keeps the vector.
        await CatchUpAsync();
        await SaveLedgerAsync(
            token,
            ledger =>
                ledger["transactions"]!
                    .AsArray()
                    .Single(entry => entry!["id"]!.GetValue<string>() == "n1")!["total"] = 900
        );
        (
            await CountAsync(
                "SELECT count(*) FROM penny.search_documents WHERE embedding_due_at IS NOT NULL"
            )
        ).ShouldBe(0);

        // Deleting the entry removes its document.
        await SaveLedgerAsync(token, ledger => ledger["transactions"] = new JsonArray());
        (await CountAsync("SELECT count(*) FROM penny.search_documents")).ShouldBe(0);
    }

    // MAZ-137: new entries and documents are bulk-copied after EF writes the rest of the
    // save, so one save that adds, edits and deletes, with new entries referencing a
    // category, account and trip created in the same save, must still index exactly.
    [Fact]
    public async Task whenSaveMixesNewEditedAndDeletedEntries_Search_ShouldIndexEveryChange()
    {
        var (token, _) = await AccountAsync("mixed@example.test");
        await SeedLedgerAsync(token);
        await CatchUpAsync();
        await SaveLedgerAsync(
            token,
            ledger =>
            {
                ledger["categories"]!
                    .AsArray()
                    .Add(
                        new JsonObject
                        {
                            ["id"] = "pets",
                            ["name"] = "Quokkas",
                            ["icon"] = "paw-outline",
                            ["color"] = "#7D5BB1",
                            ["kind"] = "expense",
                        }
                    );
                ledger["accounts"]!
                    .AsArray()
                    .Add(
                        new JsonObject
                        {
                            ["id"] = "wallet",
                            ["name"] = "Zeppelin purse",
                            ["type"] = "cash",
                        }
                    );
                ledger["trips"]!
                    .AsArray()
                    .Add(
                        new JsonObject
                        {
                            ["id"] = "rome",
                            ["name"] = "Rome",
                            ["startDate"] = "2026-11-01",
                            ["endDate"] = "2026-11-08",
                        }
                    );
                var entries = ledger["transactions"]!.AsArray();
                entries.Remove(entries.Single(entry => entry!["id"]!.GetValue<string>() == "s02"));
                entries.Single(entry => entry!["id"]!.GetValue<string>() == "s01")!["title"] =
                    "Ground coffee";
                var kibble = Entry("n1", "Kibble sack");
                kibble["categoryId"] = "pets";
                kibble["accountId"] = "wallet";
                kibble["tripId"] = "rome";
                entries.Add(kibble);
                entries.Add(Entry("n2", "Zebra crossing"));
            }
        );

        // One document per entry: 11 seeded, one deleted, two added.
        (await CountAsync("SELECT count(*) FROM penny.search_documents")).ShouldBe(12);
        (await CountAsync("SELECT count(*) FROM penny.ledger_entries")).ShouldBe(12);
        Keys(await SearchAsync(token, new { query = "kibble" })).ShouldBe(["personal:n1"]);
        Keys(await SearchAsync(token, new { query = "quokkas" })).ShouldBe(["personal:n1"]);
        Keys(await SearchAsync(token, new { query = "zeppelin purse" })).ShouldBe(["personal:n1"]);
        Keys(await SearchAsync(token, new { query = "zebra" })).ShouldBe(["personal:n2"]);
        Keys(await SearchAsync(token, new { query = "ground coffee" }))
            .ShouldContain("personal:s01");
        Keys(await SearchAsync(token, new { query = "coffee beans" }))
            .ShouldNotContain("personal:s02");
        // The edit and both new entries wait for embeddings: the copied rows are due.
        (await CatchUpAsync()).ShouldBe(3);
    }

    [Fact]
    public async Task whenTwoWorkersClaim_EmbeddingOutbox_ShouldNeverShareARow()
    {
        var (token, _) = await AccountAsync("workers@example.test");
        await SeedLedgerAsync(token);
        var repository = Fixture.Factory.Services.GetRequiredService<ISearchRepository>();
        var now = DateTimeOffset.UtcNow;
        var claims = await Task.WhenAll(
            Enumerable
                .Range(0, 2)
                .Select(worker =>
                    repository.ClaimEmbeddingsAsync(
                        "worker-" + worker,
                        now,
                        now.AddMinutes(2),
                        8,
                        Ct
                    )
                )
        );
        var first = claims[0].Select(work => work.DocumentId).ToHashSet();
        var second = claims[1].Select(work => work.DocumentId).ToHashSet();
        first.Overlaps(second).ShouldBeFalse();
        (first.Count + second.Count).ShouldBeGreaterThan(0);
        // A live lease is not claimable again; an expired one is.
        (await repository.ClaimEmbeddingsAsync("late", now, now.AddMinutes(2), 100, Ct))
            .Select(work => work.DocumentId)
            .ShouldNotContain(id => first.Contains(id) || second.Contains(id));
        var expired = await repository.ClaimEmbeddingsAsync(
            "after",
            now.AddMinutes(3),
            now.AddMinutes(5),
            100,
            Ct
        );
        expired.Count.ShouldBe(11);
        // A completion with a lost lease or a changed passage stores nothing.
        var work = expired[0];
        (
            await repository.CompleteEmbeddingsAsync(
                "worker-0",
                "model",
                [new(work.DocumentId, work.Passage, new float[384])],
                Ct
            )
        ).ShouldBe(0);
        (
            await repository.CompleteEmbeddingsAsync(
                "after",
                "model",
                [new(work.DocumentId, work.Passage + "x", new float[384])],
                Ct
            )
        ).ShouldBe(0);
        // A failure releases the lease with a later due time and one more attempt.
        await repository.ReleaseEmbeddingsAsync("after", now.AddHours(1), Ct);
        (
            await CountAsync(
                "SELECT count(*) FROM penny.search_documents WHERE lease_token IS NULL AND embedding_attempts = 1 AND embedding_due_at > now()"
            )
        ).ShouldBe(11);
    }
}
