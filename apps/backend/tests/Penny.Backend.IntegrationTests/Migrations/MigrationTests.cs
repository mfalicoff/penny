using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Configuration;
using Penny.Backend.Persistence.Migrations;
using Penny.Backend.Persistence.Schema;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Migrations;

public sealed class MigrationTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    [Fact]
    public async Task whenMigrationRepeated_ApplyAsync_ShouldApplyEveryMigrationOnce()
    {
        await Fixture.SqlAsync("DROP SCHEMA penny CASCADE", Ct);
        await using var migrator = DatabaseSettings
            .Create(Fixture.MigrationConnection)
            .CreateDataSource();
        await DatabaseMigrator.ApplyAsync(migrator, Ct);
        await DatabaseMigrator.ApplyAsync(migrator, Ct);
        await using var context = PennyDbContext.Create(Fixture.Admin);
        (await context.Database.GetAppliedMigrationsAsync(Ct)).ShouldBe(
            context.Database.GetMigrations()
        );
        (await context.Database.GetPendingMigrationsAsync(Ct)).ShouldBeEmpty();
    }

    [Fact]
    public async Task whenLockHeld_ApplyAsync_ShouldRejectWithoutApplying()
    {
        await Fixture.SqlAsync("DROP SCHEMA penny CASCADE", Ct);
        await using var owner = await Fixture.Admin.OpenConnectionAsync(Ct);
        await using var transaction = await owner.BeginTransactionAsync(Ct);
        await using var held = new NpgsqlCommand(
            "SELECT pg_advisory_xact_lock(@key)",
            owner,
            transaction
        );
        held.Parameters.AddWithValue("key", DatabaseSchema.MigrationLock);
        await held.ExecuteNonQueryAsync(Ct);
        var busy = await Should.ThrowAsync<InvalidOperationException>(() =>
            DatabaseMigrator.ApplyAsync(Fixture.Admin, Ct)
        );
        busy.Message.ShouldContain("lock");
        await transaction.RollbackAsync(Ct);
        await using var check = Fixture.Admin.CreateCommand(
            "SELECT to_regclass('penny.users') IS NULL"
        );
        (await check.ExecuteScalarAsync(Ct)).ShouldBe(true);
    }

    [Fact]
    public async Task whenHistoryNewerThanBuild_ApplyAsync_ShouldRejectWithoutChangingHistory()
    {
        await Fixture.SqlAsync(
            """INSERT INTO penny."__EFMigrationsHistory" VALUES ('29990101000000_Future', '10.0.14')""",
            Ct
        );
        var error = await Should.ThrowAsync<InvalidOperationException>(() =>
            DatabaseMigrator.ApplyAsync(Fixture.Admin, Ct)
        );
        error.Message.ShouldContain("newer");
        await using var check = Fixture.Admin.CreateCommand(
            """SELECT count(*) FROM penny."__EFMigrationsHistory" WHERE "MigrationId" = '29990101000000_Future'"""
        );
        (await check.ExecuteScalarAsync(Ct)).ShouldBe(1L);
    }

    [Fact]
    public async Task whenFoundationDatabaseExists_ApplyAsync_ShouldAdoptItAndDropLegacyVersionTable()
    {
        await Fixture.SqlAsync(
            """
            DROP SCHEMA penny CASCADE;
            CREATE SCHEMA penny;
            CREATE TABLE penny.schema_version(singleton boolean PRIMARY KEY DEFAULT TRUE CHECK(singleton),version integer NOT NULL CHECK(version>0));
            INSERT INTO penny.schema_version VALUES(TRUE,1);
            """,
            Ct
        );
        await DatabaseMigrator.ApplyAsync(Fixture.Admin, Ct);
        await using var query = Fixture.Admin.CreateCommand(
            "SELECT to_regclass('penny.schema_version') IS NULL, to_regclass('penny.ledger_entries') IS NOT NULL"
        );
        await using var row = await query.ExecuteReaderAsync(Ct);
        (await row.ReadAsync(Ct)).ShouldBeTrue();
        row.GetBoolean(0).ShouldBeTrue();
        row.GetBoolean(1).ShouldBeTrue();
    }

    [Fact]
    public async Task whenProductMigrationFails_ApplyAsync_ShouldRollBackSchemaAndHistoryTogether()
    {
        await Fixture.SqlAsync(
            """
            DROP SCHEMA penny CASCADE;
            CREATE SCHEMA penny;
            CREATE TABLE penny.users(incompatible integer);
            """,
            Ct
        );
        await Should.ThrowAsync<PostgresException>(() =>
            DatabaseMigrator.ApplyAsync(Fixture.Admin, Ct)
        );
        await using var context = PennyDbContext.Create(Fixture.Admin);
        (await context.Database.GetAppliedMigrationsAsync(Ct)).ShouldBeEmpty();
        await using var query = Fixture.Admin.CreateCommand(
            "SELECT to_regclass('penny.sessions') IS NULL"
        );
        (await query.ExecuteScalarAsync(Ct)).ShouldBe(true);
    }
}
