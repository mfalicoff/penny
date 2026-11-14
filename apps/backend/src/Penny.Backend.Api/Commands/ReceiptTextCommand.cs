using System.Text.Json;
using Penny.Backend.Api.Configuration;
using Penny.Backend.Application.Receipts;
using Penny.Backend.Application.Search;
using Penny.Backend.Persistence.Configuration;
using Penny.Backend.Persistence.Receipts;
using Penny.Backend.Persistence.Repositories;
using Penny.Backend.Persistence.Search;

namespace Penny.Backend.Api.Commands;

// `receipts-ocr [--user USER_ID] [--all]` (MAZ-125) backfills receipt text: it queues
// receipts without a text row (uploaded before MAZ-125),
// failed receipts and receipts extracted by another engine version or language set
// (every receipt with `--all`), then extracts and embeds them in this process with the
// same bounds as the worker. `receipts-ocr --status [--user USER_ID]` only reports.
// Uses the runtime connection, the receipt settings, the OCR settings and
// Search__ModelDirectory; never starts HTTP and prints counts only.
internal static class ReceiptTextCommand
{
    public const string Name = "receipts-ocr";

    public static async Task<int> RunAsync(string[] args, IConfiguration configuration)
    {
        string? userId = null;
        var all = false;
        var status = false;
        for (var index = 1; index < args.Length; index++)
            switch (args[index])
            {
                case "--user" when index + 1 < args.Length && args[index + 1].Length > 0:
                    userId = args[++index];
                    break;
                case "--all":
                    all = true;
                    break;
                case "--status":
                    status = true;
                    break;
                default:
                    return Usage();
            }
        if (status && all)
            return Usage();
        using var stopping = new CancellationTokenSource();
        ConsoleCancelEventHandler cancel = (_, signal) =>
        {
            signal.Cancel = true;
            stopping.Cancel();
        };
        Console.CancelKeyPress += cancel;
        try
        {
            var ocr = OcrOptions.Read(configuration);
            var settings = DatabaseSettings.Create(
                configuration.GetConnectionString("Postgres"),
                maxPoolSize: Math.Max(2, ocr.Limits.Concurrency + 1),
                commandTimeoutSeconds: 30
            );
            await using var database = settings.CreateDataSource();
            var receipts = new ReceiptFileStore(
                ReceiptStoreSettings.Create(
                    configuration["Receipts:Root"],
                    configuration["Receipts:MasterKey"]
                )
            );
            var repository = new PostgresReceiptTextRepository(database, receipts);
            var extractor = new LocalReceiptTextExtractor(ocr.Engine);
            var engine = extractor.Engine;
            if (status)
            {
                Console.WriteLine(
                    JsonSerializer.Serialize(
                        await repository.StatusAsync(userId, engine, stopping.Token)
                    )
                );
                return 0;
            }
            var embedder = OnnxTextEmbedder.Load(SearchOptions.Read(configuration).ModelDirectory);
            var queued = await repository.QueueAsync(userId, all, engine, stopping.Token);
            Console.Error.WriteLine(
                $"Queued {queued.Created} receipts without text and {queued.Requeued} to extract again with {engine}."
            );
            var started = DateTimeOffset.UtcNow;
            var extracted = await new ReceiptTextService(
                repository,
                extractor,
                embedder,
                ocr.Limits,
                TimeProvider.System
            ).CatchUpAsync(stopping.Token);
            var embedded = await new SearchEmbeddingService(
                new PostgresSearchRepository(database, receipts),
                embedder,
                TimeProvider.System
            ).CatchUpAsync(stopping.Token);
            Console.Error.WriteLine(
                $"Extracted {extracted} receipts and embedded {embedded} passages in {(DateTimeOffset.UtcNow - started).TotalSeconds:F1} s."
            );
            var report = await repository.StatusAsync(userId, engine, stopping.Token);
            Console.WriteLine(
                JsonSerializer.Serialize(
                    new
                    {
                        queued.Created,
                        queued.Requeued,
                        Extracted = extracted,
                        Embedded = embedded,
                        report.Pending,
                        report.Done,
                        report.Failed,
                        report.Unsupported,
                    }
                )
            );
            return 0;
        }
        catch (Exception error)
            when (error
                    is Npgsql.NpgsqlException
                        or TimeoutException
                        or OperationCanceledException
                        or InvalidOperationException
                        or Microsoft.EntityFrameworkCore.DbUpdateException
                        or Microsoft.ML.OnnxRuntime.OnnxRuntimeException
                        or IOException
            )
        {
            Console.Error.WriteLine(
                error is InvalidOperationException
                    ? error.Message
                    : "Receipt text backfill failed. Check ConnectionStrings__Postgres, connectivity, runtime grants, the receipt settings, the OCR installation and Search__ModelDirectory. No credentials or receipt content are logged."
            );
            return 1;
        }
        finally
        {
            Console.CancelKeyPress -= cancel;
        }
    }

    private static int Usage()
    {
        Console.Error.WriteLine(
            "Usage: receipts-ocr [--user USER_ID] [--all] | receipts-ocr --status [--user USER_ID]. See docs/operations.md#receipt-text-ocr."
        );
        return 1;
    }
}
