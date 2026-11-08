using System.Text.Json;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Configuration;
using Penny.Backend.Persistence.Import;
using Penny.Backend.Persistence.Repositories;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Migrations;

public sealed class ImportedRepositoryTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    [Fact]
    public async Task whenImportedRowsRead_RepositoryFlow_ShouldPreserveIdentitySessionAndReceiptIsolation()
    {
        await ImportLegacyAsync();
        await using var runtime = DatabaseSettings
            .Create(Fixture.RuntimeConnection)
            .CreateDataSource();
        var accounts = new PostgresAccountRepository(runtime);
        var sessions = new PostgresSessionRepository(runtime);
        var user = await accounts.FindByEmailAsync("Case@example.test", Ct);
        user!.Id.ShouldBe("legacy:user-01");
        user.Password.ShouldBe("synthetic-password-hash");
        user.Salt.ShouldBe("synthetic-salt");
        (await accounts.FindByEmailAsync("case@example.test", Ct))!.Id.ShouldBe("oidc-user");
        (
            await accounts.FindByIdentityAsync("https://issuer.example.test", "subject-01", Ct)
        )!.Id.ShouldBe("oidc-user");
        (await sessions.FindUserAsync("synthetic-session-hash", At(1793577600122), Ct)).ShouldBe(
            user.Id
        );
        (
            await sessions.FindUserAsync("synthetic-session-hash", At(1793577600123), Ct)
        ).ShouldBeNull();
        var receipts = new PostgresReceiptRepository(runtime, Fixture.Receipts);
        (await receipts.ReadAsync(user.Id, "receipt", Ct))!.Data.ShouldBe(
            LegacyDatabase.ReceiptBytes
        );
        (await receipts.ReadAsync("oidc-user", "receipt", Ct)).ShouldBeNull();
    }

    [Fact]
    public async Task whenConcurrentLedgerSaves_RepositoryFlow_ShouldAcceptExactlyOneRevision()
    {
        await ImportLegacyAsync();
        await using var runtime = DatabaseSettings
            .Create(Fixture.RuntimeConnection)
            .CreateDataSource();
        var ledgers = new PostgresLedgerRepository(runtime);
        var expected = (await ledgers.ReadAsync("oidc-user", Ct))!;
        var outcomes = await Task.WhenAll(
            Enumerable
                .Range(0, 2)
                .Select(_ => ledgers.TrySaveAsync("oidc-user", expected.Revision, expected, Ct))
        );
        outcomes.Count(accepted => accepted).ShouldBe(1);
        (await ledgers.ReadAsync("oidc-user", Ct))!.Revision.ShouldBe(1);
        (await ledgers.TrySaveAsync("oidc-user", 0, expected, Ct)).ShouldBeFalse();
    }

    [Fact]
    public async Task whenLedgerChanged_RepositoryFlow_ShouldApplyKeyedDiffAtomically()
    {
        await ImportLegacyAsync();
        var ledgers = new PostgresLedgerRepository(Fixture.Admin);
        var current = (await ledgers.ReadAsync("legacy:user-01", Ct))!;
        // Remove the account (clearing references first, as the caller must),
        // rename the category and add an entry; keep everything else.
        var changed = current with
        {
            Currency = "USD",
            Accounts = [],
            Categories = [current.Categories[0] with { Name = "Dining" }],
            Recurring = [current.Recurring[0] with { AccountId = null }],
            Entries =
            [
                current.Entries[0] with
                {
                    AccountId = null,
                },
                current.Entries[0] with
                {
                    Id = "added",
                    AccountId = null,
                    ReceiptId = null,
                },
            ],
        };
        (
            await ledgers.TrySaveAsync("legacy:user-01", current.Revision, changed, Ct)
        ).ShouldBeTrue();
        var saved = (await ledgers.ReadAsync("legacy:user-01", Ct))!;
        saved.Revision.ShouldBe(current.Revision + 1);
        JsonSerializer
            .Serialize(saved)
            .ShouldBe(
                JsonSerializer.Serialize(
                    changed with
                    {
                        Revision = current.Revision + 1,
                        Entries = changed
                            .Entries.OrderBy(e => e.Id, StringComparer.Ordinal)
                            .ToList(),
                    }
                )
            );
        // A stale writer changes nothing.
        (
            await ledgers.TrySaveAsync("legacy:user-01", current.Revision, current, Ct)
        ).ShouldBeFalse();
        (await ledgers.ReadAsync("legacy:user-01", Ct))!.Currency.ShouldBe("USD");
    }

    [Fact]
    public async Task whenPostImportWritesBackedUp_RestoreFlow_ShouldRetainAcceptedRevisionsAndReceipts()
    {
        await ImportLegacyAsync();
        var ledgers = new PostgresLedgerRepository(Fixture.Admin);
        var expected = (await ledgers.ReadAsync("oidc-user", Ct))!;
        (await ledgers.TrySaveAsync("oidc-user", expected.Revision, expected, Ct)).ShouldBeTrue();
        await using var restored = await Fixture.RestoreBackupAsync(Ct);
        var restoredLedgers = new PostgresLedgerRepository(restored.Source);
        (await restoredLedgers.ReadAsync("oidc-user", Ct))!.Revision.ShouldBe(1);
        // Receipt metadata restores from the dump; bytes come from the receipt root.
        (
            await new PostgresReceiptRepository(restored.Source, Fixture.Receipts).ReadAsync(
                "legacy:user-01",
                "receipt",
                Ct
            )
        )!.Data.ShouldBe(LegacyDatabase.ReceiptBytes);
        await using var index = restored.Source.CreateCommand(
            "SELECT to_regclass('penny.ix_household_recurring_due') IS NOT NULL"
        );
        (await index.ExecuteScalarAsync(Ct)).ShouldBe(true);
    }

    private async Task ImportLegacyAsync()
    {
        using var legacy = new LegacyDatabase();
        legacy.Seal();
        await SqliteImporter.RunAsync(
            Fixture.Admin,
            Fixture.Receipts,
            legacy.SnapshotPath,
            legacy.Sha256,
            ImportMode.Import,
            null,
            Ct
        );
    }

    private static DateTimeOffset At(long milliseconds) =>
        DateTimeOffset.FromUnixTimeMilliseconds(milliseconds);
}
