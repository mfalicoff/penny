using System.Text.Json;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Schema;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Migrations;

// `receipts-ocr` (MAZ-125) and the receipt text part of `search-verify` and
// `search-rebuild`, as separate processes with runtime credentials and the real engine.
public sealed class ReceiptTextMaintenanceTests(ApiFixture fixture) : ReceiptTextTestBase(fixture)
{
    private Dictionary<string, string> Environment() =>
        new()
        {
            ["ConnectionStrings__Postgres"] = Fixture.RuntimeConnection,
            ["Receipts__Root"] = Fixture.ReceiptRoot,
            ["Receipts__MasterKey"] = Fixture.ReceiptKey,
            ["Search__ModelDirectory"] = SearchModel.Directory,
        };

    private async Task<(int ExitCode, JsonElement Report)> RunAsync(params string[] arguments)
    {
        var (exit, output, error) = await MaintenanceProcess.RunAsync(
            null,
            arguments,
            Ct,
            Environment()
        );
        exit.ShouldBeOneOf([0, 2], error);
        return (exit, JsonDocument.Parse(output).RootElement.Clone());
    }

    // A receipt as the SQLite import (or an upload before MAZ-125) leaves it: the
    // encrypted file and its row, but no text row.
    private async Task<string> LegacyReceiptAsync(string userId, params string[] lines)
    {
        var id = Convert.ToHexStringLower(
            System.Security.Cryptography.RandomNumberGenerator.GetBytes(16)
        );
        var encrypted = Fixture.Receipts.Encrypt(
            userId,
            id,
            "legacy.pdf",
            "application/pdf",
            SyntheticReceipts.TextPdf(lines),
            Noon
        );
        await Fixture.Receipts.WriteAsync(encrypted, Ct);
        await using var context = PennyDbContext.Create(Fixture.Admin);
        context.Receipts.Add(encrypted.Row);
        await context.SaveChangesAsync(Ct);
        return id;
    }

    [Fact]
    public async Task whenReceiptsPredateOcr_ReceiptsOcr_ShouldBackfillAndRerunAfterEngineChange()
    {
        var (token, userId) = await AccountAsync("backfill@example.test");
        var linked = await LegacyReceiptAsync(
            userId,
            "Librairie Drawn and Quarterly",
            "Roman graphique en couleur 32.95"
        );
        var unlinked = await LegacyReceiptAsync(
            userId,
            "Marche Jean-Talon kiosque fermier",
            "Panier de fraises du Quebec 8.00"
        );
        await SaveEntryAsync(token, "book", "Gift", linked);
        // A link made before MAZ-125 left no text row (the save queues one now).
        await Fixture.SqlAsync(
            $"DELETE FROM penny.receipt_texts WHERE receipt_id = '{linked}'",
            Ct
        );
        await CatchUpAsync();
        var (stale, staleReport) = await RunAsync("search-verify");
        stale.ShouldBe(2);
        staleReport.GetProperty("MissingReceiptText").GetInt64().ShouldBe(1);

        var (_, before) = await RunAsync("receipts-ocr", "--status");
        before.GetProperty("Receipts").GetInt64().ShouldBe(2);
        before.GetProperty("Missing").GetInt64().ShouldBe(2);

        var (exit, report) = await RunAsync("receipts-ocr");
        exit.ShouldBe(0);
        report.GetProperty("Created").GetInt64().ShouldBe(2);
        report.GetProperty("Extracted").GetInt64().ShouldBe(2);
        report.GetProperty("Embedded").GetInt64().ShouldBe(2);
        report.GetProperty("Done").GetInt64().ShouldBe(2);
        (await TextOfAsync(unlinked)).SearchText.ShouldContain("fraises");
        var page = await SearchAsync(token, new { query = "roman graphique" });
        Keys(page).ShouldBe(["personal:book"]);
        Matches(page).ShouldBe(["text"]);
        var (clean, cleanReport) = await RunAsync("search-verify");
        clean.ShouldBe(0, cleanReport.ToString());
        cleanReport.GetProperty("ReceiptTexts").GetInt64().ShouldBe(2);

        // Nothing to do until the engine or its languages change.
        (await RunAsync("receipts-ocr"))
            .Report.GetProperty("Requeued")
            .GetInt64()
            .ShouldBe(0);
        await Fixture.SqlAsync(
            $"UPDATE penny.receipt_texts SET engine = 'tesseract 4.1.1 (eng); poppler 22.02.0' WHERE receipt_id = '{linked}'",
            Ct
        );
        (await RunAsync("receipts-ocr", "--status"))
            .Report.GetProperty("OtherEngine")
            .GetInt64()
            .ShouldBe(1);
        var (_, rerun) = await RunAsync("receipts-ocr", "--user", userId);
        rerun.GetProperty("Requeued").GetInt64().ShouldBe(1);
        rerun.GetProperty("Extracted").GetInt64().ShouldBe(1);
        (await TextOfAsync(linked)).Engine.ShouldNotStartWith("tesseract 4.1.1");
        (await RunAsync("receipts-ocr", "--all"))
            .Report.GetProperty("Requeued")
            .GetInt64()
            .ShouldBe(2);
        Keys(await SearchAsync(token, new { query = "roman graphique" }))
            .ShouldBe(["personal:book"]);
    }

    [Fact]
    public async Task whenReceiptTextStale_SearchRebuild_ShouldRecomputeItWithoutOcr()
    {
        var (token, userId) = await AccountAsync("rebuild@example.test");
        var receipt = await StoreReceiptAsync(
            userId,
            "a.pdf",
            "application/pdf",
            SyntheticReceipts.TextPdf("Fruiterie du Plateau", "Mangues Ataulfo la caisse 12.00")
        );
        await SaveEntryAsync(token, "fruit", "Market", receipt);
        await ExtractAsync();
        await CatchUpAsync();
        (await RunAsync("search-verify")).ExitCode.ShouldBe(0);
        await Fixture.SqlAsync(
            $"UPDATE penny.receipt_texts SET search_text = 'stale' WHERE receipt_id = '{receipt}'",
            Ct
        );
        await Fixture.SqlAsync(
            $"UPDATE penny.receipt_text_chunks SET embedding_model = 'old-model' WHERE receipt_id = '{receipt}'",
            Ct
        );
        var (stale, staleReport) = await RunAsync("search-verify", "--user", userId);
        stale.ShouldBe(2);
        staleReport.GetProperty("StaleReceiptText").GetInt64().ShouldBe(1);
        staleReport.GetProperty("StaleModel").GetInt64().ShouldBe(1);
        Keys(await SearchAsync(token, new { query = "mangues" })).ShouldBeEmpty();

        var (rebuilt, rebuildReport) = await RunAsync("search-rebuild", "--user", userId);
        rebuilt.ShouldBe(0);
        rebuildReport.GetProperty("ReceiptTexts").GetInt64().ShouldBe(1);
        rebuildReport.GetProperty("Pending").GetInt64().ShouldBe(0);
        (await RunAsync("search-verify")).ExitCode.ShouldBe(0);
        Keys(await SearchAsync(token, new { query = "mangues" })).ShouldBe(["personal:fruit"]);
    }

    [Fact]
    public async Task whenArgumentsInvalid_ReceiptsOcr_ShouldPrintUsage()
    {
        var (exit, _, error) = await MaintenanceProcess.RunAsync(
            null,
            ["receipts-ocr", "--everything"],
            Ct,
            Environment()
        );
        exit.ShouldBe(1);
        error.ShouldContain("Usage: receipts-ocr");
    }
}
