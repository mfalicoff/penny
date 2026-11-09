using System.Text.Json;
using Npgsql;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Configuration;
using Penny.Backend.Persistence.Migrations;
using Penny.Backend.Persistence.Schema;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Migrations;

// `search-verify` and `search-rebuild` as separate processes with runtime
// credentials, and the extension precondition of `migrate`.
public sealed class SearchMaintenanceTests(ApiFixture fixture) : SearchTestBase(fixture)
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

    [Fact]
    public async Task whenDocumentsMissingOrStale_SearchMaintenance_ShouldReportAndRebuildThem()
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, _) = await AccountAsync("bea@example.test");
        At(Noon);
        var home = Id(await CreateHouseholdAsync(alex));
        await AdmitAsync(home, alex, bea);
        await CreateExpenseAsync(
            home,
            alex,
            Expense(1000, alexId, extra: new { title = "Pizza night" })
        );
        await SeedLedgerAsync(alex);

        // Written but not yet embedded: stale until the outbox drains.
        var (pending, pendingReport) = await RunAsync("search-verify");
        pending.ShouldBe(2);
        pendingReport.GetProperty("PendingEmbeddings").GetInt64().ShouldBe(12);
        var (rebuilt, rebuildReport) = await RunAsync("search-rebuild");
        rebuilt.ShouldBe(0);
        rebuildReport.GetProperty("Embedded").GetInt64().ShouldBe(12);
        rebuildReport.GetProperty("Pending").GetInt64().ShouldBe(0);
        var (clean, cleanReport) = await RunAsync("search-verify");
        clean.ShouldBe(0);
        cleanReport.GetProperty("Documents").GetInt64().ShouldBe(12);

        // An import (or lost rows) leaves no documents; a stale normalization or model
        // is reported too. Rebuild for one user fixes that user's documents.
        await Fixture.SqlAsync("DELETE FROM penny.search_documents WHERE source = 'shared'", Ct);
        await Fixture.SqlAsync(
            "UPDATE penny.search_documents SET title_text = 'stale' WHERE entry_id = 's01'",
            Ct
        );
        await Fixture.SqlAsync(
            "UPDATE penny.search_documents SET embedding_model = 'old-model' WHERE entry_id = 's02'",
            Ct
        );
        var (stale, staleReport) = await RunAsync("search-verify", "--user", alexId);
        stale.ShouldBe(2);
        staleReport.GetProperty("Missing").GetInt64().ShouldBe(1);
        staleReport.GetProperty("StaleText").GetInt64().ShouldBe(1);
        staleReport.GetProperty("StaleModel").GetInt64().ShouldBe(1);
        Keys(await SearchAsync(bea, new { query = "pizza" })).ShouldBeEmpty();

        var (fixedUser, fixedReport) = await RunAsync("search-rebuild", "--user", alexId);
        fixedUser.ShouldBe(0);
        fixedReport.GetProperty("Written").GetInt64().ShouldBe(2);
        (await RunAsync("search-verify")).ExitCode.ShouldBe(0);
        Keys(await SearchAsync(bea, new { query = "pizza" })).Count.ShouldBe(1);
        Keys(await SearchAsync(alex, new { query = "beverage" })).ShouldContain("personal:s02");
    }

    [Fact]
    public async Task whenArgumentsInvalid_SearchMaintenance_ShouldPrintUsage()
    {
        var (exit, _, error) = await MaintenanceProcess.RunAsync(
            null,
            ["search-rebuild", "--everyone"],
            Ct,
            Environment()
        );
        exit.ShouldBe(1);
        error.ShouldContain("Usage: search-rebuild");
    }

    [Fact]
    public async Task whenExtensionsMissing_Migrate_ShouldRefuseWithoutChanges()
    {
        var name = "noext_" + Guid.NewGuid().ToString("N");
        await Fixture.SqlAsync($"CREATE DATABASE {name}", Ct);
        try
        {
            await using var target = DatabaseSettings
                .Create(
                    new NpgsqlConnectionStringBuilder(Fixture.MigrationConnection)
                    {
                        Database = name,
                    }.ConnectionString
                )
                .CreateDataSource();
            var refused = await Should.ThrowAsync<InvalidOperationException>(() =>
                DatabaseMigrator.ApplyAsync(target, Ct)
            );
            refused.Message.ShouldBe(SearchExtensions.Missing);
            await using var check = target.CreateCommand(
                "SELECT count(*) FROM pg_namespace WHERE nspname = 'penny'"
            );
            ((long)(await check.ExecuteScalarAsync(Ct))!).ShouldBe(0);
        }
        finally
        {
            await Fixture.SqlAsync($"DROP DATABASE {name} WITH (FORCE)", Ct);
        }
    }
}
