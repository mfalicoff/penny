using System.Net;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Penny.Backend.Application.Receipts;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Unlinked receipt cleanup (MAZ-165): receipts nothing links to are deleted (text, row
// and file) once past the retention; a receipt any personal entry, shared expense
// (live or deleted) or shared rule links is never touched, whoever owns it. The test
// host runs with the default 30-day retention and drives the pass explicitly. All data
// is synthetic.
public sealed class ReceiptCleanupTests(ApiFixture fixture) : ReceiptTestBase(fixture)
{
    private static readonly DateTimeOffset PastRetention = Noon.AddDays(31);

    // The clock moves past the retention; the synthetic sessions (30 days) must outlive it.
    private Task ExtendSessionsAsync() =>
        Fixture.SqlAsync(
            "UPDATE penny.sessions SET expires_at = TIMESTAMPTZ '2099-01-01 00:00:00+00'",
            Ct
        );

    private Task<long> CleanUpAsync() =>
        Fixture.Factory.Services.GetRequiredService<ReceiptCleanupService>().RunOnceAsync(Ct);

    private async Task<string> UploadIdAsync(string token, string name) =>
        (await UploadedAsync(token, name, "application/pdf", Pdf())).GetProperty("id").GetString()!;

    private Task<long> ReceiptRowsAsync(string receiptId) =>
        CountAsync($"SELECT count(*) FROM penny.receipts WHERE id = '{receiptId}'");

    // Links `receiptId` from a new personal entry, the way clients save.
    private async Task LinkPersonalAsync(string token, string entryId, string receiptId)
    {
        var snapshot = await GetLedgerAsync(token);
        snapshot["ledger"]!["transactions"]!
            .AsArray()
            .Add(
                new JsonObject
                {
                    ["id"] = entryId,
                    ["title"] = "Synthetic lunch",
                    ["kind"] = "expense",
                    ["total"] = 1000,
                    ["share"] = 1000,
                    ["categoryId"] = snapshot["ledger"]!["categories"]![0]![
                        "id"
                    ]!.GetValue<string>(),
                    ["date"] = "2026-09-28",
                    ["note"] = "",
                    ["receipt"] = new JsonObject
                    {
                        ["id"] = receiptId,
                        ["name"] = "a.pdf",
                        ["mime"] = "application/pdf",
                        ["uri"] = "/api/receipts/" + receiptId,
                    },
                }
            );
        using var saved = await PutLedgerAsync(token, snapshot);
        saved.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenReceiptsAreLinkedAnywhere_Cleanup_ShouldDeleteOnlyOldUnlinkedReceipts()
    {
        At(Noon);
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var home = Id(await CreateHouseholdAsync(alex));
        var personal = await UploadIdAsync(alex, "personal.pdf");
        await LinkPersonalAsync(alex, "lunch", personal);
        var shared = await UploadIdAsync(alex, "shared.pdf");
        await CreateExpenseAsync(
            home,
            alex,
            Expense(1000, alexId, extra: new { receiptId = shared })
        );
        // A deleted shared expense keeps its link.
        var deleted = await UploadIdAsync(alex, "deleted.pdf");
        var gone = await CreateExpenseAsync(
            home,
            alex,
            Expense(1000, alexId, extra: new { receiptId = deleted })
        );
        await ExpectAsync(
            HttpMethod.Delete,
            ExpensePath(home, Id(gone)),
            alex,
            HttpStatusCode.OK,
            new { revision = 0 }
        );
        var rule = await UploadIdAsync(alex, "rule.pdf");
        await AddRuleAsync("rent", home, alexId, 1000, "2026-10-01", "monthly");
        await Fixture.SqlAsync(
            $"UPDATE penny.household_recurring SET receipt_id = '{rule}' WHERE id = 'rent'",
            Ct
        );
        // Uploaded into a draft that was discarded, and one removed from an entry.
        var discarded = await UploadIdAsync(alex, "discarded.pdf");
        var removed = await UploadIdAsync(alex, "removed.pdf");
        await LinkPersonalAsync(alex, "dinner", removed);
        var snapshot = await GetLedgerAsync(alex);
        snapshot["ledger"]!["transactions"]!
            .AsArray()
            .Single(entry => entry!["id"]!.GetValue<string>() == "dinner")!
            .AsObject()
            .Remove("receipt");
        using (var saved = await PutLedgerAsync(alex, snapshot))
            saved.StatusCode.ShouldBe(HttpStatusCode.OK);
        var discardedPath = await StoragePathAsync(discarded);
        var removedPath = await StoragePathAsync(removed);

        // Inside the retention nothing goes.
        await ExtendSessionsAsync();
        At(Noon.AddDays(29));
        (await CleanUpAsync()).ShouldBe(0);

        // A receipt uploaded recently stays even past the others' retention.
        At(PastRetention);
        var recent = await UploadIdAsync(alex, "recent.pdf");
        (await CleanUpAsync()).ShouldBe(2);

        (await ReceiptRowsAsync(discarded)).ShouldBe(0);
        (await ReceiptRowsAsync(removed)).ShouldBe(0);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.receipt_texts WHERE receipt_id IN ('{discarded}', '{removed}')"
            )
        ).ShouldBe(0);
        StoredFiles().ShouldNotContain(path => path.Replace('\\', '/') == discardedPath);
        StoredFiles().ShouldNotContain(path => path.Replace('\\', '/') == removedPath);
        (await DownloadStatusAsync(alex, discarded)).ShouldBe(HttpStatusCode.NotFound);
        foreach (var kept in new[] { personal, shared, deleted, rule, recent })
            (await DownloadedAsync(alex, kept)).ShouldBe(Pdf());
        StoredFiles().Count.ShouldBe(5);
        (await CleanUpAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task whenAnotherOwnersExpenseLinksAReceipt_Cleanup_ShouldKeepItAndDeleteEachOwnersOwn()
    {
        At(Noon);
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        var home = Id(await CreateHouseholdAsync(alex));
        await AdmitAsync(home, alex, bea);
        // alex shares a receipt, bea attaches it to her own expense, then alex's expense
        // is deleted: only bea's expense still links alex's receipt.
        var sharedByAlex = await UploadIdAsync(alex, "shared.pdf");
        var first = await CreateExpenseAsync(
            home,
            alex,
            Expense(1000, alexId, extra: new { receiptId = sharedByAlex })
        );
        await CreateExpenseAsync(
            home,
            bea,
            Expense(1000, beaId, extra: new { receiptId = sharedByAlex })
        );
        await ExpectAsync(
            HttpMethod.Delete,
            ExpensePath(home, Id(first)),
            alex,
            HttpStatusCode.OK,
            new { revision = 0 }
        );
        await Fixture.SqlAsync(
            $"UPDATE penny.household_expenses SET receipt_id = NULL WHERE id = '{Id(first)}'",
            Ct
        );
        var alexUnlinked = await UploadIdAsync(alex, "a.pdf");
        var beaUnlinked = await UploadIdAsync(bea, "b.pdf");
        var beaLinked = await UploadIdAsync(bea, "c.pdf");
        await LinkPersonalAsync(bea, "lunch", beaLinked);

        await ExtendSessionsAsync();
        At(PastRetention);
        (await CleanUpAsync()).ShouldBe(2);

        (await ReceiptRowsAsync(alexUnlinked)).ShouldBe(0);
        (await ReceiptRowsAsync(beaUnlinked)).ShouldBe(0);
        (await DownloadedAsync(alex, sharedByAlex)).ShouldBe(Pdf());
        (await DownloadedAsync(bea, sharedByAlex)).ShouldBe(Pdf());
        (await DownloadedAsync(bea, beaLinked)).ShouldBe(Pdf());
    }
}
