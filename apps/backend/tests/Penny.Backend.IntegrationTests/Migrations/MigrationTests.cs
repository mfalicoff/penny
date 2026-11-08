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
    public async Task whenMigrationRepeated_ApplyAsync_ShouldPersistSingleVersionAndCompatibleExtension()
    {
        await Fixture.SqlAsync("DROP SCHEMA penny CASCADE; DROP EXTENSION pg_trgm", Ct);
        await using var migrator = DatabaseSettings
            .Create(Fixture.MigrationConnection)
            .CreateDataSource();
        await DatabaseMigrator.ApplyAsync(migrator, Ct);
        await DatabaseMigrator.ApplyAsync(migrator, Ct);
        await using var check = Fixture.Admin.CreateCommand(
            "SELECT version, (SELECT extversion FROM pg_extension WHERE extname='pg_trgm') FROM penny.schema_version"
        );
        await using var reader = await check.ExecuteReaderAsync(Ct);
        (await reader.ReadAsync(Ct)).ShouldBeTrue();
        reader.GetInt32(0).ShouldBe(DatabaseSchema.Version);
        reader.GetString(1).ShouldBe(DatabaseSchema.TrigramVersion);
        (await reader.ReadAsync(Ct)).ShouldBeFalse();
    }

    [Fact]
    public async Task whenLockHeldOrSchemaNewer_ApplyAsync_ShouldRejectWithoutChangingVersion()
    {
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
        await Fixture.SqlAsync("UPDATE penny.schema_version SET version=999", Ct);
        await Should.ThrowAsync<InvalidOperationException>(() =>
            DatabaseMigrator.ApplyAsync(Fixture.Admin, Ct)
        );
        await using var check = Fixture.Admin.CreateCommand(
            "SELECT version FROM penny.schema_version"
        );
        (await check.ExecuteScalarAsync(Ct)).ShouldBe(999);
    }
}
