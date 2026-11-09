using System.Text.Json;
using Penny.Backend.Persistence.Configuration;
using Penny.Backend.Persistence.Receipts;

namespace Penny.Backend.Api.Commands;

// `receipts-verify` decrypts every receipt's file and name and checks its size: exit
// 0 when every row has an intact file, 2 otherwise (after a restore, restore the
// receipt root from a copy taken after the database dump). `receipts-sweep
// [--dry-run]` removes files no row references once they are an hour old (uploads
// interrupted between file and row, rolled-back imports, crashed temporary writes).
// Both use the runtime connection, never start HTTP, print a JSON report of counts on
// stdout and never print ids, names, paths or contents.
internal static class ReceiptCommand
{
    public const string Verify = "receipts-verify";
    public const string Sweep = "receipts-sweep";

    public static async Task<int> RunAsync(string[] args, IConfiguration configuration)
    {
        bool dryRun;
        switch (args)
        {
            case [Verify]:
            case [Sweep]:
                dryRun = false;
                break;
            case [Sweep, "--dry-run"]:
                dryRun = true;
                break;
            default:
                Console.Error.WriteLine(
                    "Usage: receipts-verify | receipts-sweep [--dry-run]. See docs/migration/receipts.md."
                );
                return 1;
        }
        using var stopping = new CancellationTokenSource();
        ConsoleCancelEventHandler cancel = (_, signal) =>
        {
            signal.Cancel = true;
            stopping.Cancel();
        };
        Console.CancelKeyPress += cancel;
        try
        {
            var settings = DatabaseSettings.Create(
                configuration.GetConnectionString("Postgres"),
                maxPoolSize: 1,
                commandTimeoutSeconds: 30
            );
            await using var database = settings.CreateDataSource();
            var maintenance = new ReceiptMaintenance(
                database,
                new ReceiptFileStore(
                    ReceiptStoreSettings.Create(
                        configuration["Receipts:Root"],
                        configuration["Receipts:MasterKey"]
                    )
                )
            );
            if (args[0] == Verify)
            {
                var report = await maintenance.VerifyAsync(stopping.Token);
                Console.WriteLine(JsonSerializer.Serialize(report));
                Console.Error.WriteLine(
                    report.Clean
                        ? "Every receipt has an intact encrypted file."
                        : "Some receipts are missing or fail authentication. Restore the receipt root from a copy taken after the database backup, with the same master key."
                );
                return report.Clean ? 0 : 2;
            }
            var swept = await maintenance.SweepAsync(DateTimeOffset.UtcNow, dryRun, stopping.Token);
            Console.WriteLine(JsonSerializer.Serialize(swept));
            Console.Error.WriteLine(
                dryRun
                    ? $"{swept.Removed} unreferenced receipt files would be removed."
                    : $"Removed {swept.Removed} unreferenced receipt files."
            );
            return 0;
        }
        catch (Exception error)
            when (error
                    is Npgsql.NpgsqlException
                        or TimeoutException
                        or OperationCanceledException
                        or InvalidOperationException
                        or IOException
                        or UnauthorizedAccessException
            )
        {
            Console.Error.WriteLine(
                error is InvalidOperationException
                    ? error.Message
                    : "Receipt maintenance failed. Check ConnectionStrings__Postgres, connectivity, runtime grants and that Receipts__Root is readable and writable. No credentials or row values are logged."
            );
            return 1;
        }
        finally
        {
            Console.CancelKeyPress -= cancel;
        }
    }
}
