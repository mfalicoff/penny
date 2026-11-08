using System.Text.Json;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Import;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Migrations;

public sealed class ImportCommandTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    [Fact]
    public async Task whenMaintenanceCommandsInvoked_ImportCommandFlow_ShouldUseMigrationRoleAndReturnRedactedEvidence()
    {
        await Fixture.SqlAsync("DROP SCHEMA penny CASCADE", Ct);
        var migrated = await MaintenanceProcess.RunAsync(
            Fixture.MigrationConnection,
            ["migrate"],
            Ct
        );
        migrated.ExitCode.ShouldBe(0, migrated.Error);
        await Fixture.GrantRuntimeAsync(Ct);
        using var source = new LegacyDatabase();
        var receipts = new Dictionary<string, string>
        {
            ["Receipts__Root"] = Fixture.ReceiptRoot,
            ["Receipts__MasterKey"] = Fixture.ReceiptKey,
        };
        var snapshot = System.IO.Path.Combine(
            System.IO.Path.GetDirectoryName(source.Path)!,
            "command.sqlite"
        );
        var sealedResult = await MaintenanceProcess.RunAsync(
            null,
            ["snapshot-sqlite", source.Path, snapshot],
            Ct
        );
        sealedResult.ExitCode.ShouldBe(0, sealedResult.Error);
        var hash = SqliteSnapshot.Hash(snapshot);
        sealedResult.Output.ShouldContain(hash);
        foreach (var option in new[] { "--dry-run", "", "--verify" })
        {
            var args = new List<string> { "import-sqlite", snapshot, "--sha256", hash };
            if (option.Length > 0)
                args.Add(option);
            var result = await MaintenanceProcess.RunAsync(
                Fixture.MigrationConnection,
                args.ToArray(),
                Ct,
                receipts
            );
            result.ExitCode.ShouldBe(0, result.Error);
            var report = JsonSerializer.Deserialize<ImportReport>(result.Output)!;
            report.Tables.Count.ShouldBe(22);
            result.Output.ShouldNotContain("example.test");
            result.Error.ShouldNotContain("synthetic-password");
            result.Error.ShouldNotContain(Fixture.MigrationConnection);
            result.Error.ShouldNotContain(Fixture.ReceiptKey);
        }
        var denied = await MaintenanceProcess.RunAsync(
            Fixture.RuntimeConnection,
            ["import-sqlite", snapshot, "--sha256", hash, "--verify"],
            Ct,
            receipts
        );
        denied.ExitCode.ShouldBe(1);
        denied.Error.ShouldContain("migration-role");
        denied.Error.ShouldNotContain(Fixture.RuntimeConnection);
    }
}
