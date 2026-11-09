using System.Text.Json;
using Penny.Backend.Api.Configuration;
using Penny.Backend.Application.Search;
using Penny.Backend.Persistence.Configuration;
using Penny.Backend.Persistence.Repositories;
using Penny.Backend.Persistence.Search;

namespace Penny.Backend.Api.Commands;

// `search-rebuild [--user USER_ID]` recomputes search documents for everyone or one
// user (after an import, a normalization change or a model change) and then embeds
// everything owed, in this process. `search-verify [--user USER_ID]` compares stored
// documents with the source rows and changes nothing: exit 0 when current, 2 when
// stale. Both use the runtime connection (DML only), never start HTTP, print a JSON
// report on stdout and never print row values.
internal static class SearchCommand
{
    public const string Rebuild = "search-rebuild";
    public const string Verify = "search-verify";

    public static async Task<int> RunAsync(string[] args, IConfiguration configuration)
    {
        string? userId;
        switch (args)
        {
            case [_]:
                userId = null;
                break;
            case [_, "--user", var user] when user.Length > 0:
                userId = user;
                break;
            default:
                Console.Error.WriteLine(
                    "Usage: search-rebuild [--user USER_ID] | search-verify [--user USER_ID]. See docs/migration/search.md."
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
                maxPoolSize: 2,
                commandTimeoutSeconds: 30
            );
            await using var database = settings.CreateDataSource();
            var receipts = new Persistence.Receipts.ReceiptFileStore(
                Persistence.Receipts.ReceiptStoreSettings.Create(
                    configuration["Receipts:Root"],
                    configuration["Receipts:MasterKey"]
                )
            );
            var repository = new PostgresSearchRepository(database, receipts);
            if (args[0] == Verify)
            {
                var report = await repository.VerifyAsync(
                    userId,
                    OnnxTextEmbedder.Id,
                    stopping.Token
                );
                Console.WriteLine(JsonSerializer.Serialize(report));
                Console.Error.WriteLine(
                    report.Clean
                        ? "Search documents are current."
                        : "Search documents are stale. Run search-rebuild (and keep the embedding worker running)."
                );
                return report.Clean ? 0 : 2;
            }
            var embedder = OnnxTextEmbedder.Load(SearchOptions.Read(configuration).ModelDirectory);
            var rebuilt = await repository.RebuildAsync(userId, embedder.ModelId, stopping.Token);
            Console.Error.WriteLine(
                $"Rewrote {rebuilt.Written} and removed {rebuilt.Removed} search documents; {rebuilt.Queued} more queued for embedding."
            );
            var started = DateTimeOffset.UtcNow;
            var embedded = await new SearchEmbeddingService(
                repository,
                embedder,
                TimeProvider.System
            ).CatchUpAsync(stopping.Token);
            Console.Error.WriteLine(
                $"Embedded {embedded} documents in {(DateTimeOffset.UtcNow - started).TotalSeconds:F1} s."
            );
            Console.WriteLine(
                JsonSerializer.Serialize(
                    new
                    {
                        rebuilt.Written,
                        rebuilt.Removed,
                        rebuilt.Queued,
                        Embedded = embedded,
                        Pending = await repository.PendingEmbeddingsAsync(stopping.Token),
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
                    : "Search maintenance failed. Check ConnectionStrings__Postgres, connectivity, that `migrate` has been applied with runtime grants and Search__ModelDirectory. No credentials or row values are logged."
            );
            return 1;
        }
        finally
        {
            Console.CancelKeyPress -= cancel;
        }
    }
}
