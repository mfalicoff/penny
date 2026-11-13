using System.Text.Json;
using Microsoft.Data.Sqlite;
using Penny.Backend.Persistence.Configuration;
using Penny.Backend.Persistence.Import;
using Penny.Backend.Persistence.Migrations;
using Penny.Backend.Persistence.Receipts;

namespace Penny.Backend.Api.Commands;

internal static class MaintenanceCommand
{
    public static async Task<int> RunAsync(string[] args, IConfiguration configuration)
    {
        using var stopping = new CancellationTokenSource();
        ConsoleCancelEventHandler cancel = (_, signal) =>
        {
            signal.Cancel = true;
            stopping.Cancel();
        };
        Console.CancelKeyPress += cancel;
        try
        {
            if (args is ["snapshot-sqlite", var sourcePath, var snapshotPath])
            {
                Console.WriteLine(
                    "Snapshot SHA-256: " + SqliteSnapshot.Create(sourcePath, snapshotPath)
                );
                return 0;
            }
            ImportMode mode = ImportMode.Import;
            if (args[0] == "import-sqlite")
            {
                if (args.Length is not (4 or 5) || args[2] != "--sha256")
                    throw new ImportFailure("command-usage");
                mode =
                    args.Length == 4
                        ? ImportMode.Import
                        : args[4] switch
                        {
                            "--dry-run" => ImportMode.DryRun,
                            "--resume" => ImportMode.Resume,
                            "--verify" => ImportMode.Verify,
                            _ => throw new ImportFailure("command-usage"),
                        };
            }
            else if (args is not (["migrate"] or ["migrate", "--grant-runtime"]))
                throw new ImportFailure("command-usage");
            var settings = DatabaseSettings.Create(
                configuration.GetConnectionString("Migration"),
                maxPoolSize: 1
            );
            await using var database = settings.CreateDataSource();
            if (args[0] == "migrate")
            {
                await DatabaseMigrator.ApplyAsync(database, stopping.Token);
                Console.WriteLine("Database migration complete.");
                if (args is [_, "--grant-runtime"])
                {
                    await RuntimeGrants.ApplyAsync(database, stopping.Token);
                    Console.WriteLine("Runtime grants applied.");
                }
            }
            else
            {
                var receipts = new ReceiptFileStore(
                    ReceiptStoreSettings.Create(
                        configuration["Receipts:Root"],
                        configuration["Receipts:MasterKey"]
                    )
                );
                var report = await SqliteImporter.RunAsync(
                    database,
                    receipts,
                    args[1],
                    args[3],
                    mode,
                    (table, count) => Console.Error.WriteLine($"Validated {table}: {count} rows."),
                    stopping.Token
                );
                Console.WriteLine(JsonSerializer.Serialize(report));
            }
            return 0;
        }
        catch (ImportFailure error)
        {
            Console.Error.WriteLine(error.Message);
            Console.Error.WriteLine(
                "Usage: migrate [--grant-runtime] | snapshot-sqlite SOURCE NEW_SNAPSHOT | import-sqlite SNAPSHOT --sha256 HASH [--dry-run|--resume|--verify] | reset-password EMAIL. See docs/migration/postgresql.md."
            );
            return 1;
        }
        catch (Exception error)
            when (error
                    is Npgsql.NpgsqlException
                        or SqliteException
                        or TimeoutException
                        or OperationCanceledException
                        or InvalidOperationException
                        or IOException
                        or UnauthorizedAccessException
                        or ArgumentException
                        or Microsoft.EntityFrameworkCore.DbUpdateException
                        or System.Security.Cryptography.CryptographicException
            )
        {
            Console.Error.WriteLine(
                "Database migration/import failed. Check source access, connectivity, PostgreSQL 18, schema compatibility, migration-role privileges, the receipt store and the migration lock. No credentials or row values are logged."
            );
            return 1;
        }
        finally
        {
            Console.CancelKeyPress -= cancel;
        }
    }
}
