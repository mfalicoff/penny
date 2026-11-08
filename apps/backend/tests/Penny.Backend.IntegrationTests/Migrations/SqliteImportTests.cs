using System.Net;
using Npgsql;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Import;
using Penny.Backend.Persistence.Repositories;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Migrations;

public sealed class SqliteImportTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    private const int TargetTables = 22;

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    public async Task whenLegacySnapshotValid_ImportFlow_ShouldMapEveryTableAndRejectRepeat(
        int version
    )
    {
        using var source = new LegacyDatabase(version);
        source.Seal();
        var before = SqliteSnapshot.Hash(source.Path);
        var report = await ImportAsync(source);
        report.Tables.Count.ShouldBe(TargetTables);
        (await ImportAsync(source, ImportMode.Verify)).ShouldBeEquivalentTo(report);
        SqliteSnapshot.Hash(source.Path).ShouldBe(before);
        SqliteSnapshot.Hash(source.SnapshotPath).ShouldBe(source.Sha256);
        (await Should.ThrowAsync<ImportFailure>(() => ImportAsync(source))).Code.ShouldBe(
            "already-imported-use-verify"
        );
        await using var check = Fixture.Admin.CreateCommand(
            """
            SELECT (SELECT revision FROM penny.ledgers WHERE user_id='legacy:user-01'),
                (SELECT (extract(epoch FROM expires_at) * 1000)::bigint FROM penny.sessions),
                (SELECT string_agg(id, ',' ORDER BY sort_order) FROM penny.household_audit),
                (SELECT sum(amount_cents) FROM penny.household_splits),
                (SELECT count(*) FROM penny.users),
                (SELECT active FROM penny.household_recurring WHERE id='rule'),
                (SELECT trip_start::text || '/' || trip_end::text FROM penny.households WHERE id='h'),
                (SELECT password FROM penny.users WHERE id='oidc-user'),
                (SELECT count(*) FROM penny.ledger_categories WHERE user_id='legacy:user-01'),
                (SELECT count(*) FROM penny.household_member_periods WHERE left_at IS NULL),
                (SELECT string_agg(category_name || category_color, ',') FROM penny.household_expenses),
                (SELECT string_agg(user_id || ':' || percent_basis_points, ',' ORDER BY user_id) FROM penny.household_recurring_allocations),
                (SELECT account_id || '/' || trip_id || '/' || receipt_id FROM penny.ledger_entries),
                (SELECT start_date::text FROM penny.ledger_recurring WHERE id='rent')
            """
        );
        await using var row = await check.ExecuteReaderAsync(Ct);
        (await row.ReadAsync(Ct)).ShouldBeTrue();
        row.GetInt64(0).ShouldBe(9007199254740990L);
        row.GetInt64(1).ShouldBe(1793577600123L);
        row.GetString(2).ShouldBe("z-first,a-second");
        row.GetDecimal(3).ShouldBe(10000);
        row.GetInt64(4).ShouldBe(2);
        row.GetBoolean(5).ShouldBeTrue();
        row.GetString(6).ShouldBe("2024-02-29/2024-03-01");
        row.GetString(7).ShouldBe("");
        // upgradeLedger adds an investment category to v1 documents only.
        row.GetInt64(8).ShouldBe(version == 1 ? 2 : 1);
        row.GetInt64(9).ShouldBe(1);
        row.GetString(10).ShouldBe("Food#ABCDEF");
        row.GetString(11).ShouldBe("legacy:user-01:6000,oidc-user:4000");
        row.GetString(12).ShouldBe("bank/trip/receipt");
        row.GetString(13).ShouldBe("2024-01-01");
        var receipts = new PostgresReceiptRepository(Fixture.Admin, Fixture.Receipts);
        var receipt = (await receipts.ReadAsync("legacy:user-01", "receipt", Ct))!;
        receipt.Data.ShouldBe(LegacyDatabase.ReceiptBytes);
        receipt.Name.ShouldBe("synthetic.pdf");
    }

    [Fact]
    public async Task whenDryRunRequested_ImportFlow_ShouldValidateWithoutTargetSourceOrFileChanges()
    {
        using var source = new LegacyDatabase();
        source.Execute(
            "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE sessions SET expires=1793577600124"
        );
        var original = SqliteSnapshot.Hash(source.Path);
        source.Seal();
        var sequenceBefore = await AuditSequenceAsync();
        var preview = await ImportAsync(source, ImportMode.DryRun);
        (await AuditSequenceAsync()).ShouldBe(sequenceBefore);
        await using var check = Fixture.Admin.CreateCommand(
            "SELECT (SELECT count(*) FROM penny.users)+(SELECT count(*) FROM penny.sqlite_import)+(SELECT count(*) FROM penny.receipts)"
        );
        (await check.ExecuteScalarAsync(Ct)).ShouldBe(0L);
        ReceiptFiles().ShouldBeEmpty();
        (await ImportAsync(source)).ShouldBeEquivalentTo(preview);
        ReceiptFiles().Length.ShouldBe(1);
        SqliteSnapshot.Hash(source.Path).ShouldBe(original);
    }

    [Fact]
    public async Task whenImportInterrupted_ImportFlow_ShouldRollBackRowsAndFilesAndResumeOnlySameSnapshot()
    {
        using var source = new LegacyDatabase();
        source.Seal();
        using var stopping = CancellationTokenSource.CreateLinkedTokenSource(Ct);
        await Should.ThrowAsync<OperationCanceledException>(() =>
            SqliteImporter.RunAsync(
                Fixture.Admin,
                Fixture.Receipts,
                source.SnapshotPath,
                source.Sha256,
                ImportMode.Import,
                (table, _) =>
                {
                    if (table == "households")
                        stopping.Cancel();
                },
                stopping.Token
            )
        );
        await using (
            var check = Fixture.Admin.CreateCommand(
                "SELECT (SELECT count(*) FROM penny.users), status FROM penny.sqlite_import"
            )
        )
        await using (var row = await check.ExecuteReaderAsync(Ct))
        {
            (await row.ReadAsync(Ct)).ShouldBeTrue();
            row.GetInt64(0).ShouldBe(0);
            row.GetString(1).ShouldBe("pending");
        }
        ReceiptFiles().ShouldBeEmpty();
        using var ready = await Client.GetAsync("/api/ready", Ct);
        ready.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
        using var other = new LegacyDatabase();
        other.Execute("UPDATE sessions SET expires=1793577600124");
        other.Seal();
        (
            await Should.ThrowAsync<ImportFailure>(() => ImportAsync(other, ImportMode.Resume))
        ).Code.ShouldBe("checkpoint-source-mismatch");
        await ImportAsync(source, ImportMode.Resume);
        using var completed = await Client.GetAsync("/api/ready", Ct);
        completed.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenMemberHasNoPeriod_ImportFlow_ShouldSynthesizeMatchingPeriod()
    {
        using var source = new LegacyDatabase();
        source.Execute("DELETE FROM household_member_periods WHERE id='p1'");
        source.Seal();
        await ImportAsync(source);
        await using var query = Fixture.Admin.CreateCommand(
            "SELECT id, left_at IS NULL FROM penny.household_member_periods WHERE user_id='legacy:user-01'"
        );
        await using var row = await query.ExecuteReaderAsync(Ct);
        (await row.ReadAsync(Ct)).ShouldBeTrue();
        row.GetString(0).ShouldStartWith("legacy-member-");
        row.GetBoolean(1).ShouldBeTrue();
        (await row.ReadAsync(Ct)).ShouldBeFalse();
    }

    [Theory]
    [InlineData("PRAGMA user_version=999", "unsupported-source-schema")]
    [InlineData("PRAGMA user_version=0", "unsupported-source-schema")]
    [InlineData("ALTER TABLE users ADD COLUMN unsupported TEXT", "source-column-drift")]
    [InlineData("DROP INDEX household_expense_payment", "source-index-drift")]
    [InlineData("UPDATE household_recurring SET active=2", "invalid-boolean")]
    [InlineData("UPDATE receipts SET data='invalid-storage-type'", "invalid-binary")]
    [InlineData("UPDATE users SET salt=CAST(x'ff' AS TEXT)", "invalid-value")]
    [InlineData(
        "INSERT INTO household_member_periods SELECT 'duplicate-open',household_id,user_id,joined_at,joined_on,left_at FROM household_member_periods WHERE id='p1'",
        "membership-mismatch"
    )]
    [InlineData("UPDATE sessions SET expires=9007199254740991", "invalid-timestamp")]
    [InlineData("UPDATE sessions SET expires=9007199254740992", "invalid-integer")]
    [InlineData("UPDATE household_trips SET start_date='2024-02-30'", "invalid-date")]
    [InlineData(
        "UPDATE household_audit SET after_json='{\"note\":\"\\u0000\"}'",
        "unsupported-jsonb-text"
    )]
    [InlineData("UPDATE household_audit SET after_json='{\"note\":\"\\ud800\"}'", "invalid-value")]
    [InlineData(
        "UPDATE household_audit SET after_json='{\"x\":1,\"x\":2}'",
        "duplicate-json-property"
    )]
    [InlineData("UPDATE household_splits SET amount_cents=1", "referential-or-financial-mismatch")]
    [InlineData("UPDATE household_expenses SET category='{\"name\":\"Food\"}'", "invalid-category")]
    [InlineData(
        "UPDATE household_recurring SET allocations_json='[{\"userId\":\"oidc-user\"}]'",
        "invalid-allocations"
    )]
    // Ledger entries may only reference receipts their owner uploaded.
    [InlineData("UPDATE receipts SET user_id='oidc-user'", "target-constraint-or-encoding")]
    [InlineData(
        "PRAGMA foreign_keys=OFF; DELETE FROM users WHERE id='oidc-user'",
        "source-foreign-key"
    )]
    public async Task whenSourceInvalid_ImportFlow_ShouldRejectWithoutAdmittingRows(
        string mutation,
        string code
    )
    {
        using var source = new LegacyDatabase();
        source.Execute(mutation);
        source.Seal();
        var failure = await Should.ThrowAsync<ImportFailure>(() =>
            ImportAsync(source, ImportMode.DryRun)
        );
        failure.Code.ShouldBe(code);
        failure.Message.ShouldNotContain("example.test");
        await using var query = Fixture.Admin.CreateCommand("SELECT count(*) FROM penny.users");
        (await query.ExecuteScalarAsync(Ct)).ShouldBe(0L);
        ReceiptFiles().ShouldBeEmpty();
    }

    [Theory]
    [InlineData("rows")]
    [InlineData("file")]
    public async Task whenTargetChangedAfterImport_VerifyFlow_ShouldRejectReconciliationMismatch(
        string tampered
    )
    {
        using var source = new LegacyDatabase();
        source.Seal();
        await ImportAsync(source);
        if (tampered == "rows")
            await Fixture.SqlAsync("UPDATE penny.ledger_entries SET note='changed'", Ct);
        else
        {
            var file = ReceiptFiles().Single();
            var bytes = await File.ReadAllBytesAsync(file, Ct);
            bytes[0] ^= 1;
            await File.WriteAllBytesAsync(file, bytes, Ct);
        }
        (
            await Should.ThrowAsync<ImportFailure>(() => ImportAsync(source, ImportMode.Verify))
        ).Code.ShouldBe("reconciliation-mismatch");
    }

    [Fact]
    public async Task whenChecksumWrongOrTargetOccupied_ImportFlow_ShouldRejectBeforeCreatingCheckpoint()
    {
        using var source = new LegacyDatabase();
        source.Seal();
        (
            await Should.ThrowAsync<ImportFailure>(() =>
                SqliteImporter.RunAsync(
                    Fixture.Admin,
                    Fixture.Receipts,
                    source.SnapshotPath,
                    new string('0', 64),
                    ImportMode.Import,
                    null,
                    Ct
                )
            )
        ).Code.ShouldBe("source-checksum-mismatch");
        await Fixture.SqlAsync(
            "INSERT INTO penny.users VALUES('existing','synthetic@example.test','','synthetic')",
            Ct
        );
        (await Should.ThrowAsync<ImportFailure>(() => ImportAsync(source))).Code.ShouldBe(
            "target-not-empty"
        );
        await using var query = Fixture.Admin.CreateCommand(
            "SELECT count(*) FROM penny.sqlite_import"
        );
        (await query.ExecuteScalarAsync(Ct)).ShouldBe(0L);
    }

    [Fact]
    public async Task whenMigrationLockHeld_ImportFlow_ShouldRejectConcurrentImporter()
    {
        using var source = new LegacyDatabase();
        source.Seal();
        await using var connection = await Fixture.Admin.OpenConnectionAsync(Ct);
        await using var transaction = await connection.BeginTransactionAsync(Ct);
        await using var held = new NpgsqlCommand(
            "SELECT pg_advisory_xact_lock(@key)",
            connection,
            transaction
        );
        held.Parameters.AddWithValue("key", Persistence.Schema.DatabaseSchema.MigrationLock);
        await held.ExecuteNonQueryAsync(Ct);
        var failure = await Should.ThrowAsync<InvalidOperationException>(() => ImportAsync(source));
        failure.Message.ShouldContain("lock");
    }

    private async Task<string> AuditSequenceAsync()
    {
        await using var sequence = Fixture.Admin.CreateCommand(
            "SELECT last_value::text || ':' || is_called::text FROM penny.household_audit_sort_order_seq"
        );
        return (string)(await sequence.ExecuteScalarAsync(Ct))!;
    }

    private string[] ReceiptFiles() =>
        Directory.Exists(Fixture.ReceiptRoot)
            ? Directory.GetFiles(Fixture.ReceiptRoot, "*", SearchOption.AllDirectories)
            : [];

    private Task<ImportReport> ImportAsync(
        LegacyDatabase source,
        ImportMode mode = ImportMode.Import
    ) =>
        SqliteImporter.RunAsync(
            Fixture.Admin,
            Fixture.Receipts,
            source.SnapshotPath,
            source.Sha256,
            mode,
            null,
            Ct
        );
}
