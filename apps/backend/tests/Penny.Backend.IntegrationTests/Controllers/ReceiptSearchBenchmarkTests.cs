using System.Diagnostics;
using System.Globalization;
using System.Text;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Abstractions.Search;
using Penny.Backend.Domain.Errors;
using Penny.Backend.Domain.Search;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Configuration;
using Penny.Backend.Persistence.Repositories;
using Pgvector.Npgsql;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Performance evidence for the receipt text part of docs/reference/search.md (MAZ-125;
// explicit: run with `--filter-class *ReceiptSearchBenchmarkTests --explicit on`).
// Seeds one viewer with many long receipts (substring and typo cost) and a much larger
// set of other users' receipt chunks closer to the query than the viewer's (meaning
// recall of the filtered HNSW scan), times the repository's search and records EXPLAIN
// (ANALYZE, BUFFERS) plans via auto_explain. Results go to
// .cache/receipt-search-benchmark.txt; nothing is committed.
public sealed class ReceiptSearchBenchmarkTests(ApiFixture fixture) : SearchTestBase(fixture)
{
    private const int ViewerReceipts = 1_000;
    private const int ViewerEntries = 5_000;
    private const int OtherReceipts = 30_000;
    private const int ChunksPerReceipt = 3;
    private const int Runs = 10;

    [Fact(Explicit = true)]
    public async Task whenViewerHasManyLongReceipts_Search_ShouldStayWithinItsTimeout()
    {
        var report = new StringBuilder();
        try
        {
            await MeasureAsync(report);
        }
        finally
        {
            await File.WriteAllTextAsync(
                Path.Combine(
                    Path.GetDirectoryName(SearchModel.Directory)!,
                    "..",
                    "receipt-search-benchmark.txt"
                ),
                report.ToString(),
                Ct
            );
        }
    }

    private async Task MeasureAsync(StringBuilder report)
    {
        var (_, viewer) = await AccountAsync("receipt-benchmark@example.test");
        var (_, other) = await AccountAsync("receipt-benchmark-other@example.test");
        var embedder = Fixture.Factory.Services.GetRequiredService<ITextEmbedder>();
        var model = embedder.ModelId;
        var query = embedder.EmbedQuery("zzqx");
        var queryText =
            "["
            + string.Join(',', query.Select(v => v.ToString("R", CultureInfo.InvariantCulture)))
            + "]";
        var seed = Stopwatch.StartNew();
        // The viewer's receipts are really sealed: search results open their names.
        await using (
            var context = Penny.Backend.Persistence.Schema.PennyDbContext.Create(Fixture.Admin)
        )
        {
            for (var i = 1; i <= ViewerReceipts; i++)
                context.Receipts.Add(
                    Fixture
                        .Receipts.Encrypt(
                            viewer,
                            string.Create(CultureInfo.InvariantCulture, $"rv{i}"),
                            "receipt.pdf",
                            "application/pdf",
                            "%PDF-1.4"u8,
                            Noon
                        )
                        .Row
                );
            await context.SaveChangesAsync(Ct);
        }
        // Receipt words are 4-8 letters drawn from md5 (a-p): long texts hold most
        // trigrams of that alphabet, the worst case for `<%` candidates.
        await SeedAsync(
            string.Create(
                CultureInfo.InvariantCulture,
                $"""
                DELETE FROM penny.search_documents;
                INSERT INTO penny.receipts (id, user_id, storage_path, encryption_version, key_salt, file_nonce, name_nonce, name_encrypted, mime, size_bytes, created_at)
                SELECT 'ro' || i, '{other}',
                       substr(md5('p' || i), 1, 2) || '/' || md5('s' || i), 1,
                       decode(repeat('00', 32), 'hex'), decode(repeat('00', 12), 'hex'), decode(repeat('00', 12), 'hex'),
                       decode('00', 'hex'), 'application/pdf', 1000, now()
                FROM generate_series({ViewerReceipts + 1}, {ViewerReceipts + OtherReceipts}) AS i;
                INSERT INTO penny.receipt_texts (receipt_id, status, method, engine, content, search_text, pages, attempts, extracted_at)
                SELECT 'rv' || i, 'done', 'text', 'bench', t, t, 1, 1, now()
                FROM generate_series(1, {ViewerReceipts}) AS i,
                LATERAL (
                    SELECT string_agg(translate(substr(md5((i * 100003 + w)::text), 1, 4 + w % 5), '0123456789', 'ghijklmnop'), ' ') AS t
                    FROM generate_series(1, 1000 + (i * 37) % 9000) AS w
                ) AS words;
                INSERT INTO penny.receipt_texts (receipt_id, status, method, engine, content, search_text, pages, attempts, extracted_at)
                SELECT 'ro' || i, 'done', 'text', 'bench', 'other', 'other', 1, 1, now()
                FROM generate_series({ViewerReceipts + 1}, {ViewerReceipts + OtherReceipts}) AS i;
                DELETE FROM penny.ledger_entries WHERE user_id = '{viewer}';
                INSERT INTO penny.ledger_entries (user_id, id, title, kind, total_cents, share_cents, category_id, account_id, trip_id, entry_date, note, receipt_id, recurring_id)
                SELECT '{viewer}', 'b' || i, 'Groceries #' || i, 'expense', 1000, 1000, 'food', NULL, NULL,
                       DATE '2020-01-01' + (i % 2000), '', CASE WHEN i <= {ViewerReceipts} THEN 'rv' || i END, NULL
                FROM generate_series(1, {ViewerEntries}) AS i;
                """
            )
        );
        await using var maintenance = DatabaseSettings
            .Create(Fixture.RuntimeConnection, maxPoolSize: 2, commandTimeoutSeconds: 30)
            .CreateDataSource();
        await new PostgresSearchRepository(maintenance, Fixture.Receipts).RebuildAsync(
            viewer,
            model,
            _ => [],
            Ct
        );
        // Chunks after the rebuild (which re-chunks with the stand-in above). Other
        // users' chunks are closer to the query (cosine ~0.95) than the viewer's (~0.85).
        await SeedAsync(
            string.Create(
                CultureInfo.InvariantCulture,
                $"""
                DELETE FROM penny.receipt_text_chunks;
                DROP INDEX penny.ix_receipt_text_chunks_embedding;
                INSERT INTO penny.receipt_text_chunks (receipt_id, ordinal, passage, embedding, embedding_model, embedding_attempts)
                SELECT r.id, o, 'passage', v.embedding, '{model}', 0
                FROM penny.receipts r, generate_series(0, {ChunksPerReceipt - 1}) AS o,
                LATERAL (
                    SELECT array_agg(q + (random() - 0.5) * CASE WHEN r.user_id = '{viewer}' THEN 0.11 ELSE 0.058 END ORDER BY n)::vector AS embedding
                    FROM unnest('{queryText}'::vector::real[]) WITH ORDINALITY AS u(q, n)
                    WHERE r.id IS NOT NULL
                ) AS v;
                -- Built once after the bulk insert (the migration's definition).
                SET maintenance_work_mem = '256MB';
                SET max_parallel_maintenance_workers = 0;
                CREATE INDEX ix_receipt_text_chunks_embedding ON penny.receipt_text_chunks USING hnsw (embedding vector_cosine_ops);
                ANALYZE;
                """
            )
        );
        report.AppendLine(
            CultureInfo.InvariantCulture,
            $"Seeded {ViewerReceipts} viewer receipts (avg {await ScalarAsync($"SELECT round(avg(length(search_text))) FROM penny.receipt_texts WHERE receipt_id LIKE 'rv%'")} chars, max {await ScalarAsync($"SELECT max(length(search_text)) FROM penny.receipt_texts WHERE receipt_id LIKE 'rv%'")}), {ViewerEntries} viewer entries, {OtherReceipts} other receipts, {await ScalarAsync("SELECT count(*) FROM penny.receipt_text_chunks")} chunks in {seed.Elapsed.TotalSeconds:F0} s"
        );
        report.AppendLine(
            CultureInfo.InvariantCulture,
            $"receipt_texts {await ScalarAsync("SELECT pg_size_pretty(pg_total_relation_size('penny.receipt_texts'))")}, trigram index {await ScalarAsync("SELECT pg_size_pretty(pg_relation_size('penny.ix_receipt_texts_search_trgm'))")}"
        );

        await using var runtime = DatabaseSettings
            .Create(Fixture.RuntimeConnection, maxPoolSize: 4, commandTimeoutSeconds: 30)
            .CreateDataSource();
        var repository = new PostgresSearchRepository(runtime, Fixture.Receipts);
        var cases = new (string Name, string Query, bool Meaning)[]
        {
            ("substring, absent (\"zzqx\")", "zzqx", false),
            ("substring + typo, common (\"hij\")", "hij", false),
            ("typo, no match (\"qqqqzzzz\")", "qqqqzzzz", false),
            ("typo, close words (\"abcdkgh\")", "abcdkgh", false),
            ("meaning (\"zzqx\" vector)", "zzqx", true),
        };
        // The same searches with the receipts' search text cut to each length.
        foreach (var cap in new[] { 0, 20_000, 2_000 })
        {
            if (cap > 0)
                await SeedAsync(
                    string.Create(
                        CultureInfo.InvariantCulture,
                        $"UPDATE penny.receipt_texts SET search_text = left(search_text, {cap}) WHERE receipt_id LIKE 'rv%'"
                    )
                );
            if (cap > 0)
                // Without the dead rows and the trigram index's pending list the update left.
                await SeedAsync("VACUUM ANALYZE penny.receipt_texts");
            report.AppendLine();
            report.AppendLine(
                cap == 0 ? "Search text as stored:" : $"Search text cut to {cap} characters:"
            );
            report.AppendLine(
                CultureInfo.InvariantCulture,
                $"word_similarity over all viewer receipts: {await ProbeAsync("SELECT count(*) FROM penny.receipt_texts WHERE receipt_id LIKE 'rv%' AND word_similarity('abcdkgh', search_text) >= 0.6"):F0} ms, LIKE '%hij%': {await ProbeAsync("SELECT count(*) FROM penny.receipt_texts WHERE receipt_id LIKE 'rv%' AND search_text LIKE '%hij%'"):F0} ms"
            );
            report.AppendLine("| Query | Results | p50 (ms) | max (ms) | timeouts |");
            report.AppendLine("| --- | --- | --- | --- | --- |");
            foreach (var (name, text, meaning) in cases)
            {
                var times = new List<double>();
                long results = 0;
                var timeouts = 0;
                for (var run = 0; run < Runs; run++)
                {
                    var clock = Stopwatch.StartNew();
                    try
                    {
                        results = (
                            await repository.SearchAsync(
                                Criteria(viewer, text, meaning ? query : null, model),
                                Ct
                            )
                        ).TotalCount;
                    }
                    catch (BackendFailure)
                    {
                        timeouts++;
                    }
                    times.Add(clock.Elapsed.TotalMilliseconds);
                }
                report.AppendLine(
                    CultureInfo.InvariantCulture,
                    $"| {name} | {results} | {times.Order().ElementAt(times.Count / 2):F0} | {times.Max():F0} | {timeouts} |"
                );
            }
        }

        // Meaning recall: every viewer receipt is above the threshold (0.80) but other
        // users' chunks are closer, so a filtered scan must get past them.
        var readable = await CountAsync(
            $"SELECT count(*) FROM penny.search_documents WHERE user_id = '{viewer}' AND receipt_id IS NOT NULL"
        );
        long found;
        try
        {
            found = (
                await repository.SearchAsync(Criteria(viewer, "zzqx", query, model), Ct)
            ).TotalCount;
        }
        catch (BackendFailure)
        {
            found = -1;
        }
        report.AppendLine();
        report.AppendLine(
            CultureInfo.InvariantCulture,
            $"Meaning recall through the repository: {found} results of min({readable}, 200) expected"
        );
        // The chunk query alone (the readable rule reduced to the uploader), with the
        // planner's choice and with the HNSW scan forced (enable_sort off), at pgvector's
        // default hnsw.max_scan_tuples and raised.
        var chunkQuery = string.Create(
            CultureInfo.InvariantCulture,
            $"""
            SELECT count(DISTINCT receipt_id) FROM (
              SELECT c.receipt_id FROM penny.receipt_text_chunks c
              WHERE c.embedding IS NOT NULL AND c.embedding_model = '{model}'
                AND EXISTS (SELECT 1 FROM penny.receipts r WHERE r.id = c.receipt_id AND r.user_id = '{viewer}')
                AND EXISTS (SELECT 1 FROM penny.search_documents d WHERE d.receipt_id = c.receipt_id AND d.user_id = '{viewer}')
              ORDER BY c.embedding <=> '{queryText}' LIMIT 200) AS top
            """
        );
        var grouped = string.Create(
            CultureInfo.InvariantCulture,
            $"""
            SELECT count(*) FROM (
              SELECT c.receipt_id, min(c.embedding <=> '{queryText}') AS distance FROM penny.receipt_text_chunks c
              WHERE c.embedding IS NOT NULL AND c.embedding_model = '{model}'
                AND EXISTS (SELECT 1 FROM penny.receipts r WHERE r.id = c.receipt_id AND r.user_id = '{viewer}')
                AND EXISTS (SELECT 1 FROM penny.search_documents d WHERE d.receipt_id = c.receipt_id AND d.user_id = '{viewer}')
              GROUP BY c.receipt_id ORDER BY distance LIMIT 200) AS top
            """
        );
        foreach (
            var (name, settings, sql) in new[]
            {
                ("planner's choice, top 200 chunks", "", chunkQuery),
                (
                    "HNSW forced, max_scan_tuples 20000 (default)",
                    "SET LOCAL enable_sort = off;",
                    chunkQuery
                ),
                (
                    "HNSW forced, max_scan_tuples 200000",
                    "SET LOCAL enable_sort = off; SET LOCAL hnsw.max_scan_tuples = 200000;",
                    chunkQuery
                ),
                ("exact, best chunk per receipt, top 200 receipts", "", grouped),
            }
        )
        {
            var (count, elapsed) = await ChunkProbeAsync(settings, sql);
            report.AppendLine(
                CultureInfo.InvariantCulture,
                $"- {name}: {count} receipts, {elapsed:F0} ms"
            );
        }

        report.AppendLine();
        report.AppendLine("EXPLAIN (ANALYZE, BUFFERS) via auto_explain:");
        var builder = new NpgsqlDataSourceBuilder(
            new NpgsqlConnectionStringBuilder(Fixture.AdminConnection)
            {
                Options = "-c session_preload_libraries=auto_explain",
                NoResetOnClose = true,
            }.ConnectionString
        );
        builder.UseVector();
        builder.UsePhysicalConnectionInitializer(
            _ => throw new NotSupportedException(),
            async connection =>
            {
                await using var set = connection.CreateCommand();
                set.CommandText =
                    "SET auto_explain.log_min_duration = 0; SET auto_explain.log_analyze = on; SET auto_explain.log_buffers = on; SET auto_explain.log_timing = on";
                await set.ExecuteNonQueryAsync();
            }
        );
        await using var explained = builder.Build();
        var explaining = new PostgresSearchRepository(explained, Fixture.Receipts);
        foreach (var (text, meaning) in new[] { ("abcdkgh", false), ("zzqx", true) })
            try
            {
                await explaining.SearchAsync(
                    Criteria(viewer, text, meaning ? query : null, model),
                    Ct
                );
            }
            catch (BackendFailure) { }
        await Task.Delay(TimeSpan.FromSeconds(5), Ct);
        var log = await Fixture.ServerLogAsync();
        var start = log.IndexOf("duration:", StringComparison.Ordinal);
        report.AppendLine(start < 0 ? log : log[start..]);
    }

    // Seeding outlasts the fixture's command timeout.
    // Milliseconds of one statement (the median of three).
    private async Task<double> ProbeAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(Fixture.AdminConnection);
        await connection.OpenAsync(Ct);
        var times = new List<double>();
        for (var run = 0; run < 3; run++)
        {
            await using var command = new NpgsqlCommand(sql, connection) { CommandTimeout = 0 };
            var clock = Stopwatch.StartNew();
            await command.ExecuteScalarAsync(Ct);
            times.Add(clock.Elapsed.TotalMilliseconds);
        }
        return times.Order().ElementAt(1);
    }

    // A chunk query in a transaction with the search's vector settings plus `settings`.
    private async Task<(long Count, double Milliseconds)> ChunkProbeAsync(
        string settings,
        string sql
    )
    {
        await using var connection = new NpgsqlConnection(Fixture.AdminConnection);
        await connection.OpenAsync(Ct);
        await using var transaction = await connection.BeginTransactionAsync(Ct);
        await using (
            var set = new NpgsqlCommand(
                "SET LOCAL hnsw.iterative_scan = relaxed_order; SET LOCAL hnsw.ef_search = 200; "
                    + settings,
                connection,
                transaction
            )
        )
            await set.ExecuteNonQueryAsync(Ct);
        await using var command = new NpgsqlCommand(sql, connection, transaction)
        {
            CommandTimeout = 0,
        };
        var clock = Stopwatch.StartNew();
        var count = (long)(await command.ExecuteScalarAsync(Ct))!;
        return (count, clock.Elapsed.TotalMilliseconds);
    }

    private async Task SeedAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(Fixture.AdminConnection);
        await connection.OpenAsync(Ct);
        await using var command = new NpgsqlCommand(sql, connection) { CommandTimeout = 0 };
        await command.ExecuteNonQueryAsync(Ct);
    }

    private static SearchCriteria Criteria(
        string viewer,
        string query,
        float[]? vector,
        string model
    )
    {
        var request = SearchReader.Read(
            System.Text.Json.JsonSerializer.SerializeToElement(new { query })
        );
        return new(viewer, request, null, 51, vector, 0.80, model);
    }
}
