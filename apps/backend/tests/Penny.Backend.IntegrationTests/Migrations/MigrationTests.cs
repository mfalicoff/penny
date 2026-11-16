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
    public async Task whenHistoryFromBeforeTheSquash_ApplyAsync_ShouldUpgradeToTheSquashedSchema()
    {
        // The catalog of a database created by the squashed InitialSchema (ResetAsync).
        var fresh = await CatalogAsync();
        await using var migrator = DatabaseSettings
            .Create(Fixture.MigrationConnection)
            .CreateDataSource();
        await PreSquashDatabaseAsync(migrator);
        await SqlAsMigratorAsync(
            migrator,
            """
            INSERT INTO penny.users (id, email, password, salt)
            VALUES ('user-alex', 'alex.squash@example.test', 'synthetic-hash', 'synthetic-salt');
            INSERT INTO penny.sessions (token_hash, user_id, expires_at)
            VALUES ('session-alex', 'user-alex', now() + interval '1 day');
            INSERT INTO penny.households (id, name, currency, creator_id, created_at)
            VALUES ('home', 'Squash home', 'CAD', 'user-alex', now());
            INSERT INTO penny.push_outbox
                (id, user_id, household_id, event_type, entity_id, payload, created_at, attempts, next_attempt_at)
            VALUES ('outbox-1', 'user-alex', 'home', 'expense.created', 'expense-1', '{}', now(), 0, now());
            INSERT INTO penny.push_devices
                (token, user_id, session_hash, platform, updated_at, environment, provider)
            VALUES
                ('ExponentPushToken[synthetic]', 'user-alex', 'session-alex', 'android', now(), NULL, 'expo'),
                ('apns-synthetic', 'user-alex', 'session-alex', 'ios', now(), 'sandbox', 'apns');
            INSERT INTO penny.push_deliveries
                (outbox_id, token, attempts, next_attempt_at, provider, ticket_id, sent_at)
            VALUES
                ('outbox-1', 'ExponentPushToken[synthetic]', 1, now(), 'expo', 'ticket-1', now()),
                ('outbox-1', 'apns-synthetic', 0, now(), 'apns', NULL, NULL);
            INSERT INTO penny.sqlite_import (singleton, source_sha256, source_version, status)
            VALUES (true, repeat('A', 64), 2, 'pending');
            """
        );

        await DatabaseMigrator.ApplyAsync(migrator, Ct);
        await DatabaseMigrator.ApplyAsync(migrator, Ct);

        (await CatalogAsync()).ShouldBe(fresh);
        await using var context = PennyDbContext.Create(Fixture.Admin);
        // Moved onto the squashed history, then every later migration applied.
        var applied = (await context.Database.GetAppliedMigrationsAsync(Ct)).ToList();
        applied[0].ShouldBe(PreSquashUpgrade.SquashedMigration);
        applied.ShouldBe(context.Database.GetMigrations());
        (await ScalarAsync("SELECT string_agg(token, ',') FROM penny.push_devices")).ShouldBe(
            "apns-synthetic"
        );
        (await ScalarAsync("SELECT string_agg(token, ',') FROM penny.push_deliveries")).ShouldBe(
            "apns-synthetic"
        );
        (await ScalarAsync("SELECT email FROM penny.users")).ShouldBe("alex.squash@example.test");
    }

    [Fact]
    public async Task whenHistoryOnlyPartlyBeforeTheSquash_ApplyAsync_ShouldRejectWithoutChangingIt()
    {
        await using var migrator = DatabaseSettings
            .Create(Fixture.MigrationConnection)
            .CreateDataSource();
        await PreSquashDatabaseAsync(migrator);
        await SqlAsMigratorAsync(
            migrator,
            """DELETE FROM penny."__EFMigrationsHistory" WHERE "MigrationId" = '20261112020756_AddReceiptTexts'"""
        );

        var error = await Should.ThrowAsync<InvalidOperationException>(() =>
            DatabaseMigrator.ApplyAsync(migrator, Ct)
        );

        error.Message.ShouldContain("newer");
        (
            await ScalarAsync(
                """SELECT count(*)::text FROM penny."__EFMigrationsHistory" WHERE "MigrationId" LIKE '202611%'"""
            )
        ).ShouldBe("6");
        (await ScalarAsync("SELECT to_regclass('penny.sqlite_import')::text")).ShouldBe(
            "penny.sqlite_import"
        );
    }

    // The schema the seven pre-squash migrations built, owned by the migration role as in a
    // real deployment (Fixtures/pre-squash-schema.sql).
    private async Task PreSquashDatabaseAsync(NpgsqlDataSource migrator)
    {
        await Fixture.SqlAsync("DROP SCHEMA penny CASCADE", Ct);
        await using var stream = typeof(MigrationTests).Assembly.GetManifestResourceStream(
            "Penny.Backend.IntegrationTests.Fixtures.pre-squash-schema.sql"
        )!;
        using var reader = new StreamReader(stream);
        await SqlAsMigratorAsync(migrator, await reader.ReadToEndAsync(Ct));
    }

    private static async Task SqlAsMigratorAsync(NpgsqlDataSource migrator, string sql)
    {
        await using var command = migrator.CreateCommand(sql);
        await command.ExecuteNonQueryAsync(Ct);
    }

    private async Task<string?> ScalarAsync(string sql)
    {
        await using var command = Fixture.Admin.CreateCommand(sql);
        return (string?)await command.ExecuteScalarAsync(Ct);
    }

    // Columns (without their physical order), constraints, indexes and history of `penny`.
    private Task<string?> CatalogAsync() =>
        ScalarAsync(
            """
            SELECT string_agg(line, E'\n' ORDER BY line) FROM (
                SELECT format('column %s.%s %s notnull=%s default=%s collation=%s identity=%s',
                       c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                       pg_get_expr(d.adbin, d.adrelid), co.collname, a.attidentity) AS line
                  FROM pg_attribute a
                  JOIN pg_class c ON c.oid = a.attrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'penny'
                  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                  LEFT JOIN pg_collation co ON co.oid = a.attcollation AND a.attcollation <> 0
                 WHERE c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
                UNION ALL
                SELECT format('constraint %s.%s %s', c.relname, con.conname, pg_get_constraintdef(con.oid))
                  FROM pg_constraint con
                  JOIN pg_class c ON c.oid = con.conrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'penny'
                UNION ALL
                SELECT format('index %s', pg_get_indexdef(i.indexrelid))
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'penny'
                UNION ALL
                SELECT format('history %s %s', "MigrationId", "ProductVersion")
                  FROM penny."__EFMigrationsHistory"
            ) catalog
            """
        );

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
