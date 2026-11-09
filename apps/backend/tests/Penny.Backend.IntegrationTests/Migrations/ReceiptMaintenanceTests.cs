using System.Text.Json;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Receipts;
using Penny.Backend.Persistence.Repositories;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Migrations;

// Backup/restore consistency between receipt metadata and encrypted files, and the
// `receipts-verify` / `receipts-sweep` commands as separate processes with runtime
// credentials. All data is synthetic.
public sealed class ReceiptMaintenanceTests(ApiFixture fixture) : ReceiptTestBase(fixture)
{
    private Dictionary<string, string> Environment() =>
        new()
        {
            ["ConnectionStrings__Postgres"] = Fixture.RuntimeConnection,
            ["Receipts__Root"] = Fixture.ReceiptRoot,
            ["Receipts__MasterKey"] = Fixture.ReceiptKey,
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
        // Reports carry counts only.
        output.ShouldNotContain(Fixture.ReceiptRoot);
        return (exit, JsonDocument.Parse(output).RootElement.Clone());
    }

    [Fact]
    public async Task whenDatabaseRestoredFromBackup_ReceiptStore_ShouldServeEveryBackedUpReceipt()
    {
        var token = await RegisterAsync("owner@example.test");
        var userId = (string)
            (await ScalarAsync("SELECT id FROM penny.users WHERE email = 'owner@example.test'"))!;
        var kept = Pdf(4096);
        var keptId = (await UploadedAsync(token, "kept.pdf", "application/pdf", kept))
            .GetProperty("id")
            .GetString()!;

        // Database first, files after: every row in the dump finds its file.
        await using var restored = await Fixture.RestoreBackupAsync(Ct);
        var later = (await UploadedAsync(token, "later.pdf", "application/pdf", Pdf(100)))
            .GetProperty("id")
            .GetString()!;

        var maintenance = new ReceiptMaintenance(restored.Source, Fixture.Receipts);
        var report = await maintenance.VerifyAsync(Ct);
        report.ShouldBe(new ReceiptVerifyReport(1, 1, 0, 0, 1, kept.Length));
        report.Clean.ShouldBeTrue();
        var repository = new PostgresReceiptRepository(restored.Source, Fixture.Receipts);
        var read = (await repository.ReadVisibleAsync(userId, keptId, Ct))!;
        read.Name.ShouldBe("kept.pdf");
        Sha256(read.Data).ShouldBe(Sha256(kept));
        (await repository.ReadVisibleAsync(userId, later, Ct)).ShouldBeNull();
    }

    [Fact]
    public async Task whenFilesMissingOrTampered_ReceiptsVerify_ShouldReportAndFail()
    {
        var token = await RegisterAsync("owner@example.test");
        var ids = new List<string>();
        foreach (var name in new[] { "a.pdf", "b.pdf", "c.pdf" })
            ids.Add(
                (await UploadedAsync(token, name, "application/pdf", Pdf()))
                    .GetProperty("id")
                    .GetString()!
            );

        var (exit, report) = await RunAsync("receipts-verify");
        exit.ShouldBe(0);
        report.GetProperty("Receipts").GetInt64().ShouldBe(3);
        report.GetProperty("Verified").GetInt64().ShouldBe(3);
        report.GetProperty("Bytes").GetInt64().ShouldBe(3 * Pdf().Length);

        File.Delete(Path.Combine(Fixture.ReceiptRoot, await StoragePathAsync(ids[0])));
        var tampered = Path.Combine(Fixture.ReceiptRoot, await StoragePathAsync(ids[1]));
        var bytes = await File.ReadAllBytesAsync(tampered, Ct);
        bytes[^1] ^= 0x80;
        await File.WriteAllBytesAsync(tampered, bytes, Ct);

        (exit, report) = await RunAsync("receipts-verify");
        exit.ShouldBe(2);
        report.GetProperty("Verified").GetInt64().ShouldBe(1);
        report.GetProperty("Missing").GetInt64().ShouldBe(1);
        report.GetProperty("Corrupt").GetInt64().ShouldBe(1);
    }

    [Fact]
    public async Task whenUnreferencedFilesAge_ReceiptsSweep_ShouldRemoveOnlyOldOrphans()
    {
        var token = await RegisterAsync("owner@example.test");
        var userId = (string)
            (await ScalarAsync("SELECT id FROM penny.users WHERE email = 'owner@example.test'"))!;
        var referenced = (await UploadedAsync(token, "kept.pdf", "application/pdf", Pdf()))
            .GetProperty("id")
            .GetString()!;
        var referencedPath = await StoragePathAsync(referenced);
        var old = DateTime.UtcNow - ReceiptMaintenance.SweepGrace - TimeSpan.FromMinutes(5);
        Age(referencedPath, old);

        // A file whose row never committed, an unfinished temporary write and a
        // recent orphan that may still be waiting for its row.
        var orphan = await OrphanAsync(userId);
        Age(orphan, old);
        var temporary =
            orphan[..2] + "/" + orphan[..2] + new string('0', 30) + ".tmp-0123456789abcdef";
        await File.WriteAllBytesAsync(Path.Combine(Fixture.ReceiptRoot, temporary), [1, 2, 3], Ct);
        Age(temporary, old);
        var recent = await OrphanAsync(userId);
        // Not the store's: never listed or removed.
        var foreign = Path.Combine(Fixture.ReceiptRoot, "README");
        await File.WriteAllTextAsync(foreign, "operator notes", Ct);
        Age("README", old);

        var (exit, report) = await RunAsync("receipts-sweep", "--dry-run");
        exit.ShouldBe(0);
        report.GetProperty("Examined").GetInt64().ShouldBe(3);
        report.GetProperty("Removed").GetInt64().ShouldBe(2);
        report.GetProperty("DryRun").GetBoolean().ShouldBeTrue();
        StoredFiles().Count.ShouldBe(5);

        (exit, report) = await RunAsync("receipts-sweep");
        report.GetProperty("Removed").GetInt64().ShouldBe(2);
        StoredFiles()
            .Select(path => path.Replace('\\', '/'))
            .Order(StringComparer.Ordinal)
            .ShouldBe(new[] { referencedPath, recent, "README" }.Order(StringComparer.Ordinal));
        (await DownloadedAsync(token, referenced)).ShouldBe(Pdf());
        (exit, _) = await RunAsync("receipts-verify");
        exit.ShouldBe(0);
    }

    [Fact]
    public async Task whenArgumentsAreUnknown_ReceiptCommand_ShouldPrintUsage()
    {
        var (exit, _, error) = await MaintenanceProcess.RunAsync(
            null,
            ["receipts-sweep", "--force"],
            Ct,
            Environment()
        );
        exit.ShouldBe(1);
        error.ShouldContain("Usage: receipts-verify | receipts-sweep [--dry-run]");
    }

    private async Task<string> OrphanAsync(string userId)
    {
        var encrypted = Fixture.Receipts.Encrypt(
            userId,
            Guid.NewGuid().ToString("N"),
            "orphan.pdf",
            "application/pdf",
            Pdf(),
            DateTimeOffset.UtcNow
        );
        await Fixture.Receipts.WriteAsync(encrypted, Ct);
        return encrypted.Row.StoragePath;
    }

    private void Age(string relative, DateTime modified) =>
        File.SetLastWriteTimeUtc(Path.Combine(Fixture.ReceiptRoot, relative), modified);
}
