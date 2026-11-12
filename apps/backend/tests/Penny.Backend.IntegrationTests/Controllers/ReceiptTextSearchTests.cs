using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Penny.Backend.Application.Abstractions.Search;
using Penny.Backend.Application.Receipts;
using Penny.Backend.Domain.Search;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Receipt text as a searchable field (MAZ-125) on real PostgreSQL with the real OCR
// engine and the real multilingual model: substring, typo and meaning matches, the
// receipt's own visibility, and deletion or replacement in the writer's transaction.
public sealed class ReceiptTextSearchTests(ApiFixture fixture) : ReceiptTextTestBase(fixture)
{
    private static JsonNode ReceiptCases => Cases["receiptCases"]!;

    private static string[] Lines(JsonNode receipt) =>
        [.. receipt["lines"]!.AsArray().Select(line => line!.GetValue<string>())];

    // The fixture ledger with each receipt uploaded as a text PDF and linked.
    private async Task<string> SeedReceiptCasesAsync(string email)
    {
        var (token, _) = await AccountAsync(email);
        var ledger = ReceiptCases["ledger"]!.DeepClone();
        foreach (var receipt in ReceiptCases["receipts"]!.AsArray())
        {
            var id = await UploadReceiptAsync(
                token,
                "receipt.pdf",
                "application/pdf",
                SyntheticReceipts.TextPdf(Lines(receipt!))
            );
            ledger["transactions"]!
                .AsArray()
                .Single(entry =>
                    entry!["id"]!.GetValue<string>() == receipt!["entryId"]!.GetValue<string>()
                )!["receipt"] = Link(id);
        }
        await SeedLedgerAsync(token, ledger);
        await CatchUpAsync();
        return token;
    }

    [Fact]
    public async Task whenReceiptFixturesRun_Search_ShouldMatchReceiptTextByTextTypoAndMeaning()
    {
        var token = await SeedReceiptCasesAsync("receipt-cases@example.test");
        var cases = ReceiptCases["cases"]!.AsArray();
        // Until the text is extracted (and embedded), nothing matches through it.
        foreach (var item in cases)
            if (item!["before"] is JsonArray hidden)
                foreach (var key in hidden.Select(key => key!.GetValue<string>()))
                    Keys(await SearchAsync(token, item["request"]!))
                        .ShouldNotContain(key, item["name"]!.GetValue<string>() + " (before)");
        (await ExtractAsync()).ShouldBe(2);
        // Text and typo matches need no embedding; meaning waits for the chunk embeddings.
        Keys(await SearchAsync(token, new { query = "wood screws" })).ShouldBe(["personal:r01"]);
        Keys(await SearchAsync(token, new { query = "tools" })).ShouldNotContain("personal:r01");
        (
            await CountAsync(
                "SELECT count(*) FROM penny.receipt_text_chunks WHERE embedding_due_at IS NOT NULL"
            )
        ).ShouldBe(2, "due chunks");
        (await CatchUpAsync()).ShouldBe(2);
        foreach (var item in cases)
        {
            var name = item!["name"]!.GetValue<string>();
            var page = await SearchAsync(token, item["request"]!);
            if (item["keys"] is JsonArray keys)
            {
                var expected = keys.Select(key => key!.GetValue<string>()).ToList();
                Keys(page).Take(expected.Count).ToList().ShouldBe(expected, name);
                Matches(page)
                    .Take(expected.Count)
                    .ToList()
                    .ShouldBe(
                        [.. item["matches"]!.AsArray().Select(match => match!.GetValue<string>())],
                        name
                    );
            }
            if (item["meaning"] is JsonArray meaning)
                foreach (var key in meaning.Select(key => key!.GetValue<string>()))
                {
                    Keys(page).ShouldContain(key, name);
                    MatchOf(page, key).ShouldBe("meaning", name);
                }
        }
    }

    [Fact]
    public async Task whenReceiptReplacedOrRemoved_Search_ShouldDropItsTextInTheSameTransaction()
    {
        var (token, _) = await AccountAsync("replace@example.test");
        var first = await UploadReceiptAsync(
            token,
            "a.pdf",
            "application/pdf",
            SyntheticReceipts.TextPdf("Boulangerie Saint-Viateur", "Bagels sesame douzaine 14.40")
        );
        var second = await UploadReceiptAsync(
            token,
            "b.pdf",
            "application/pdf",
            SyntheticReceipts.TextPdf("Epicerie Fine Olivieri", "Huile d'olive extra vierge 19.95")
        );
        await SaveEntryAsync(token, "e1", "Groceries", first);
        await SaveEntryAsync(token, "e2", "Snacks", first);
        await ExtractAsync();
        await CatchUpAsync();
        Keys(await SearchAsync(token, new { query = "bagels" }))
            .ShouldBe(["personal:e1", "personal:e2"]);

        // Replacing the receipt on one entry keeps the text the other entry still links.
        await SaveEntryAsync(token, "e1", "Groceries", second);
        (await TextOfAsync(first)).Status.ShouldBe(ReceiptTextStatus.Done);
        Keys(await SearchAsync(token, new { query = "bagels" })).ShouldBe(["personal:e2"]);
        (await TextOfAsync(second)).Status.ShouldBe(ReceiptTextStatus.Done);
        Keys(await SearchAsync(token, new { query = "olive" })).ShouldBe(["personal:e1"]);

        // The last link goes: the text and its chunks are deleted with the save.
        await SaveEntryAsync(token, "e2", "Snacks", null);
        (await TextRowAsync(first)).ShouldBeNull();
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.receipt_text_chunks WHERE receipt_id = '{first}'"
            )
        ).ShouldBe(0);
        Keys(await SearchAsync(token, new { query = "bagels" })).ShouldBeEmpty();
        await RemoveEntryAsync(token, "e1");
        (await TextRowAsync(second)).ShouldBeNull();
        Keys(await SearchAsync(token, new { query = "olive" })).ShouldBeEmpty();

        // Linking it again queues a new extraction.
        await SaveEntryAsync(token, "e3", "Again", first);
        (await TextOfAsync(first)).Status.ShouldBe(ReceiptTextStatus.Pending);
        await ExtractAsync();
        Keys(await SearchAsync(token, new { query = "bagels" })).ShouldBe(["personal:e3"]);
    }

    [Fact]
    public async Task whenSharedExpenseHasReceipt_Search_ShouldMatchItOnlyForReceiptReaders()
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, _) = await AccountAsync("bea@example.test");
        var (cole, _) = await AccountAsync("cole@example.test");
        var (outsider, _) = await AccountAsync("outsider@example.test");
        At(Noon);
        var home = Id(await CreateHouseholdAsync(alex));
        await AdmitAsync(home, alex, bea);
        await AdmitAsync(home, alex, cole);
        At(Noon.AddDays(10));
        // Cole leaves; an expense he had no share in stays hidden from him, receipt too.
        await ExpectAsync(
            HttpMethod.Post,
            $"/api/households/{home}/leave",
            cole,
            System.Net.HttpStatusCode.OK
        );
        var receipt = await UploadReceiptAsync(
            alex,
            "dinner.pdf",
            "application/pdf",
            SyntheticReceipts.TextPdf("Trattoria Da Enzo", "Risotto ai funghi porcini 26.00")
        );
        var created = await CreateExpenseAsync(
            home,
            alex,
            Expense(2600, alexId, "2026-10-08", new { title = "Dinner out", receiptId = receipt })
        );
        var expense = Id(created);
        // Alex's private receipt on a personal entry.
        var secret = await UploadReceiptAsync(
            alex,
            "secret.pdf",
            "application/pdf",
            SyntheticReceipts.TextPdf("Bijouterie Lapierre", "Bague de fiancailles en or 1890.00")
        );
        await SaveEntryAsync(alex, "ring", "Gift", secret);
        await ExtractAsync();
        await CatchUpAsync();

        foreach (var member in new[] { alex, bea })
        {
            var page = await SearchAsync(member, new { query = "porcini" });
            Keys(page).ShouldBe(["shared:" + expense]);
            Matches(page).ShouldBe(["text"]);
        }
        foreach (var hidden in new[] { cole, outsider, bea })
        {
            var page = await SearchAsync(hidden, new { query = "fiancailles" });
            Keys(page).ShouldBeEmpty();
            Total(page).ShouldBe(0);
            Keys(await SearchAsync(hidden, new { query = "bague de fiancailles en or" }))
                .ShouldNotContain("personal:ring");
        }
        foreach (var hidden in new[] { cole, outsider })
        {
            Total(await SearchAsync(hidden, new { query = "porcini" })).ShouldBe(0);
            Total(await SearchAsync(hidden, new { query = "trattoria" })).ShouldBe(0);
        }
        Keys(await SearchAsync(alex, new { query = "fiancailles" })).ShouldBe(["personal:ring"]);

        // Deleting the expense removes the receipt's text in the same transaction.
        await ExpectAsync(
            HttpMethod.Delete,
            ExpensePath(home, expense),
            alex,
            System.Net.HttpStatusCode.OK,
            new { revision = created.GetProperty("revision").GetInt64() }
        );
        (await TextRowAsync(receipt)).ShouldBeNull();
        Keys(await SearchAsync(alex, new { query = "porcini" })).ShouldBeEmpty();
    }

    [Fact]
    public async Task whenHiddenReceiptsAreCloser_Search_ShouldStillFindTheVisibleReceiptByMeaning()
    {
        var (owner, ownerId) = await AccountAsync("owner@example.test");
        var (viewer, _) = await AccountAsync("viewer@example.test");
        var receipt = await UploadReceiptAsync(
            viewer,
            "tools.pdf",
            "application/pdf",
            SyntheticReceipts.TextPdf(Lines(ReceiptCases["receipts"]![0]!))
        );
        await SaveEntryAsync(viewer, "mine", "Saturday errands", receipt);
        // Another user's receipt, linked to their own entry, whose chunks are copied
        // MeaningLimit + 10 times with the query's own vector: closer than anything the
        // viewer has. Filtering after ranking would leave the viewer nothing.
        var hidden = await UploadReceiptAsync(
            owner,
            "hidden.pdf",
            "application/pdf",
            SyntheticReceipts.TextPdf(Lines(ReceiptCases["receipts"]![0]!))
        );
        await SaveEntryAsync(owner, "theirs", "Hidden", hidden);
        await ExtractAsync();
        await CatchUpAsync();
        var embedder = Fixture.Factory.Services.GetRequiredService<ITextEmbedder>();
        var vector =
            "["
            + string.Join(
                ',',
                embedder
                    .EmbedQuery(SearchText.Normalize("tools"))
                    .Select(value => value.ToString("R", CultureInfo.InvariantCulture))
            )
            + "]";
        await Fixture.SqlAsync(
            $"""
            INSERT INTO penny.receipt_text_chunks (receipt_id, ordinal, passage, embedding, embedding_model, embedding_attempts)
            SELECT '{hidden}', 100 + g, 'copy', '{vector}'::vector, embedding_model, 0
            FROM penny.receipt_text_chunks, generate_series(1, 210) AS g
            WHERE receipt_id = '{hidden}' AND ordinal = 0
            """,
            Ct
        );
        var page = await SearchAsync(viewer, new { query = "tools" });
        Keys(page).ShouldContain("personal:mine");
        MatchOf(page, "personal:mine").ShouldBe("meaning");
        Keys(page).ShouldNotContain("personal:theirs");
        // The owner finds their own receipt; the viewer's stays out of their results.
        var own = await SearchAsync(owner, new { query = "tools" });
        Keys(own).ShouldContain("personal:theirs");
        Keys(own).ShouldNotContain("personal:mine");
        _ = ownerId;
    }
}
