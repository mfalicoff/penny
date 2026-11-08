using System.Data;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Persistence.Migrations;
using Penny.Backend.Persistence.Receipts;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Import;

public static class SqliteImporter
{
    private const int ReceiptBatch = 100;

    public static async Task<ImportReport> RunAsync(
        NpgsqlDataSource target,
        ReceiptFileStore receipts,
        string snapshotPath,
        string sourceSha256,
        ImportMode mode,
        Action<string, long>? progress,
        CancellationToken cancellationToken
    )
    {
        using var source = new SqliteImportSource(snapshotPath, sourceSha256);
        await using var context = PennyDbContext.Create(target);
        context.Database.SetCommandTimeout(TimeSpan.FromMinutes(5));
        context.ChangeTracker.AutoDetectChangesEnabled = false;
        await context.Database.OpenConnectionAsync(cancellationToken);
        var connection = (NpgsqlConnection)context.Database.GetDbConnection();
        await DatabaseMigrator.AcquireLockAsync(connection, cancellationToken);
        var written = new List<string>();
        var committed = false;
        try
        {
            await CheckTargetAsync(context, connection, source.Sha256, mode, cancellationToken);
            var plan = LegacyTransform.Build(source, cancellationToken);
            // An isolated, frozen target only: never an online merge or dual write.
            await using var transaction = await context.Database.BeginTransactionAsync(
                IsolationLevel.RepeatableRead,
                cancellationToken
            );
            if (mode != ImportMode.Verify)
            {
                await RequireEmptyAsync(context, cancellationToken);
                await AddAsync(
                    context,
                    ImportTables.BeforeReceipts,
                    plan,
                    progress,
                    cancellationToken
                );
                await AddReceiptsAsync(
                    context,
                    receipts,
                    source,
                    written,
                    progress,
                    cancellationToken
                );
                await AddAsync(
                    context,
                    ImportTables.AfterReceipts,
                    plan,
                    progress,
                    cancellationToken
                );
                if (mode != ImportMode.DryRun)
                    // Explicit sort_order values bypass the identity; continue after them.
                    await context.Database.ExecuteSqlRawAsync(
                        "SELECT setval(pg_get_serial_sequence('penny.household_audit', 'sort_order'), COALESCE(MAX(sort_order), 0) + 1, false) FROM penny.household_audit",
                        cancellationToken
                    );
            }
            var report = await ReconcileAsync(context, receipts, source, plan, cancellationToken);
            source.VerifyUnchanged();
            if (mode is ImportMode.DryRun or ImportMode.Verify)
            {
                await transaction.RollbackAsync(cancellationToken);
                return report;
            }
            var checkpoint = await context.SqliteImport.SingleAsync(cancellationToken);
            if (checkpoint.Status != "pending" || checkpoint.SourceSha256 != source.Sha256)
                throw new ImportFailure("checkpoint-changed");
            checkpoint.Status = "complete";
            checkpoint.Manifest = JsonSerializer.Serialize(report);
            context.ChangeTracker.DetectChanges();
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            committed = true;
            return report;
        }
        catch (DbUpdateException error) when (error.InnerException is PostgresException database)
        {
            throw database.SqlState == PostgresErrorCodes.InsufficientPrivilege
                ? new ImportFailure("migration-role-required")
                : new ImportFailure("target-constraint-or-encoding", database.TableName, null);
        }
        catch (PostgresException error)
            when (error.SqlState == PostgresErrorCodes.InsufficientPrivilege)
        {
            throw new ImportFailure("migration-role-required");
        }
        finally
        {
            if (!committed)
                // Files from a rolled-back attempt are unreferenced; remove them.
                foreach (var path in written)
                    receipts.Delete(path);
            await DatabaseMigrator.ReleaseLockAsync(connection);
        }
    }

    private static async Task CheckTargetAsync(
        PennyDbContext context,
        NpgsqlConnection connection,
        string hash,
        ImportMode mode,
        CancellationToken ct
    )
    {
        if (
            connection.PostgreSqlVersion.Major != DatabaseSchema.PostgresMajor
            || connection.PostgresParameters.GetValueOrDefault("server_encoding") != "UTF8"
        )
            throw new ImportFailure("target-postgres-or-encoding");
        if ((await context.Database.GetPendingMigrationsAsync(ct)).Any())
            throw new ImportFailure("migrate-target-first");
        // Runtime credentials can read product tables but never write import metadata.
        var canWrite = await context
            .Database.SqlQueryRaw<bool>(
                "SELECT has_table_privilege('penny.sqlite_import', 'INSERT, UPDATE') AS \"Value\""
            )
            .SingleAsync(ct);
        if (!canWrite)
            throw new ImportFailure("migration-role-required");
        var existing = await context.SqliteImport.AsNoTracking().SingleOrDefaultAsync(ct);
        if (existing is not null)
        {
            if (existing.SourceSha256 != hash)
                throw new ImportFailure("checkpoint-source-mismatch");
            if (mode == ImportMode.Verify && existing.Status == "complete")
                return;
            if (mode == ImportMode.Resume && existing.Status == "pending")
                return;
            throw new ImportFailure(
                existing.Status == "complete"
                    ? "already-imported-use-verify"
                    : "pending-import-use-resume"
            );
        }
        if (mode is ImportMode.Resume or ImportMode.Verify)
            throw new ImportFailure("checkpoint-missing");
        await RequireEmptyAsync(context, ct);
        if (mode == ImportMode.Import)
        {
            context.SqliteImport.Add(
                new SqliteImportCheckpoint
                {
                    Singleton = true,
                    SourceSha256 = hash,
                    SourceVersion = 2,
                    Status = "pending",
                }
            );
            await context.SaveChangesAsync(ct);
            context.ChangeTracker.Clear();
        }
    }

    private static async Task RequireEmptyAsync(PennyDbContext context, CancellationToken ct)
    {
        if (await context.Receipts.AnyAsync(ct))
            throw new ImportFailure("target-not-empty");
        foreach (var table in ImportTables.BeforeReceipts.Concat(ImportTables.AfterReceipts))
            if (await table.AnyAsync(context, ct))
                throw new ImportFailure("target-not-empty");
    }

    private static async Task AddAsync(
        PennyDbContext context,
        IImportTableSpec[] tables,
        ImportPlan plan,
        Action<string, long>? progress,
        CancellationToken ct
    )
    {
        foreach (var table in tables)
        {
            ct.ThrowIfCancellationRequested();
            var name = table.Table(context);
            table.Add(context, plan);
            var count = context.ChangeTracker.Entries().LongCount();
            try
            {
                await context.SaveChangesAsync(ct);
            }
            catch (DbUpdateException error) when (error.InnerException is PostgresException)
            {
                throw new ImportFailure("target-constraint-or-encoding", name, null);
            }
            context.ChangeTracker.Clear();
            progress?.Invoke(name, count);
        }
    }

    private static async Task AddReceiptsAsync(
        PennyDbContext context,
        ReceiptFileStore store,
        SqliteImportSource source,
        List<string> written,
        Action<string, long>? progress,
        CancellationToken ct
    )
    {
        long count = 0;
        var importedAt = DateTimeOffset.UtcNow;
        foreach (var row in LegacyTransform.ReceiptRows(source, ct))
        {
            var encrypted = store.Encrypt(
                row.Text("user_id"),
                row.Text("id"),
                row.Text("name"),
                row.Text("mime"),
                row.Bytes("data"),
                importedAt
            );
            // Dry runs write too; uncommitted files are removed when the run ends.
            await store.WriteAsync(encrypted, ct);
            written.Add(encrypted.Row.StoragePath);
            context.Receipts.Add(encrypted.Row);
            if (++count % ReceiptBatch == 0)
                await SaveReceiptsAsync(context, ct);
        }
        await SaveReceiptsAsync(context, ct);
        progress?.Invoke("receipts", count);
    }

    private static async Task SaveReceiptsAsync(PennyDbContext context, CancellationToken ct)
    {
        try
        {
            await context.SaveChangesAsync(ct);
        }
        catch (DbUpdateException error) when (error.InnerException is PostgresException)
        {
            throw new ImportFailure("target-constraint-or-encoding", "receipts", null);
        }
        context.ChangeTracker.Clear();
    }

    private static async Task<ImportReport> ReconcileAsync(
        PennyDbContext context,
        ReceiptFileStore store,
        SqliteImportSource source,
        ImportPlan plan,
        CancellationToken ct
    )
    {
        var reports = new List<ImportTableReport>();
        foreach (var table in ImportTables.BeforeReceipts)
            reports.Add(await CompareAsync(context, table, plan, ct));
        reports.Add(await CompareReceiptsAsync(context, store, source, ct));
        foreach (var table in ImportTables.AfterReceipts)
            reports.Add(await CompareAsync(context, table, plan, ct));
        return new(source.Sha256, 2, reports);
    }

    private static async Task<ImportTableReport> CompareAsync(
        PennyDbContext context,
        IImportTableSpec table,
        ImportPlan plan,
        CancellationToken ct
    )
    {
        var expected = await table.ExpectedAsync(context, plan);
        if (await table.ActualAsync(context, ct) != expected)
            throw new ImportFailure("reconciliation-mismatch", expected.Table, null);
        return expected;
    }

    // Receipts compare plaintext: the target side decrypts every file and filename.
    private static async Task<ImportTableReport> CompareReceiptsAsync(
        PennyDbContext context,
        ReceiptFileStore store,
        SqliteImportSource source,
        CancellationToken ct
    )
    {
        var expected = ImportDigest.Receipts(
            LegacyTransform
                .ReceiptRows(source, ct)
                .Select(row => new ReceiptEvidence(
                    row.Text("id"),
                    row.Text("user_id"),
                    row.Text("name"),
                    row.Text("mime"),
                    row.Bytes("data").LongLength,
                    Convert.ToHexString(SHA256.HashData(row.Bytes("data")))
                ))
        );
        var actual = new List<ReceiptEvidence>();
        await foreach (
            var row in context.Receipts.AsNoTracking().AsAsyncEnumerable().WithCancellation(ct)
        )
        {
            try
            {
                var content = await store.ReadContentAsync(row, ct);
                actual.Add(
                    new ReceiptEvidence(
                        row.Id,
                        row.UserId,
                        store.ReadName(row),
                        row.Mime,
                        content.LongLength,
                        Convert.ToHexString(SHA256.HashData(content))
                    )
                );
            }
            catch (Exception error) when (error is CryptographicException or IOException)
            {
                throw new ImportFailure("reconciliation-mismatch", "receipts", null);
            }
        }
        var report = ImportDigest.Receipts(actual);
        return report == expected
            ? report
            : throw new ImportFailure("reconciliation-mismatch", "receipts", null);
    }
}
