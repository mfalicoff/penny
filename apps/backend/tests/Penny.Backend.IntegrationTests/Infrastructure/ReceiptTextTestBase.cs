using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Abstractions.Receipts;
using Penny.Backend.Application.Abstractions.Search;
using Penny.Backend.Application.Receipts;
using Shouldly;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// Receipt text suites (MAZ-125). The shared host runs no OCR worker; tests extract
// explicitly with the real local engine (tesseract and poppler must be installed) or,
// where only search behaviour matters, with a fixed-text extractor.
public abstract class ReceiptTextTestBase(ApiFixture fixture) : SearchTestBase(fixture)
{
    protected ReceiptTextService Texts =>
        Fixture.Factory.Services.GetRequiredService<ReceiptTextService>();

    protected Task<long> ExtractAsync() => Texts.CatchUpAsync(Ct);

    // The host's repository and engine with other bounds.
    protected ReceiptTextService TextsWith(
        ReceiptTextSettings settings,
        IReceiptTextExtractor? extractor = null
    )
    {
        var services = Fixture.Factory.Services;
        return new ReceiptTextService(
            services.GetRequiredService<IReceiptTextRepository>(),
            extractor ?? services.GetRequiredService<IReceiptTextExtractor>(),
            services.GetRequiredService<ITextEmbedder>(),
            settings,
            Fixture.Factory.Clock
        );
    }

    protected static ReceiptTextSettings Limits => ReceiptTextSettings.Default;

    protected async Task<string> UploadReceiptAsync(
        string token,
        string name,
        string mime,
        byte[] content
    )
    {
        using var request = Authorized(HttpMethod.Post, "/api/receipts", bearer: token);
        request.Content = JsonContent.Create(
            new
            {
                name,
                mime,
                base64 = Convert.ToBase64String(content),
            }
        );
        using var response = await Client.SendAsync(request, Ct);
        var text = await response.Content.ReadAsStringAsync(Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.Created, text);
        return JsonDocument.Parse(text).RootElement.GetProperty("id").GetString()!;
    }

    // The upload's storage path (encrypted file, receipt row, queued text) without HTTP,
    // for synthetic photos larger than the shared host's small body limit.
    protected async Task<string> StoreReceiptAsync(
        string userId,
        string name,
        string mime,
        byte[] content
    )
    {
        var id = Convert.ToHexStringLower(
            System.Security.Cryptography.RandomNumberGenerator.GetBytes(16)
        );
        await Fixture
            .Factory.Services.GetRequiredService<IReceiptRepository>()
            .CreateAsync(
                userId,
                new StoredReceipt(id, name, mime, content),
                Fixture.Factory.Clock.GetUtcNow(),
                Ct
            );
        return id;
    }

    // Adds (or replaces) a personal entry, optionally with a receipt.
    protected Task SaveEntryAsync(
        string token,
        string id,
        string title,
        string? receiptId,
        string note = "",
        string date = "2026-11-02"
    ) =>
        SaveLedgerAsync(
            token,
            ledger =>
            {
                var entries = ledger["transactions"]!.AsArray();
                var existing = entries.FirstOrDefault(entry =>
                    entry!["id"]!.GetValue<string>() == id
                );
                if (existing is not null)
                    entries.Remove(existing);
                var entry = new JsonObject
                {
                    ["id"] = id,
                    ["title"] = title,
                    ["kind"] = "expense",
                    ["total"] = 1000,
                    ["share"] = 1000,
                    ["categoryId"] = ledger["categories"]![0]!["id"]!.GetValue<string>(),
                    ["date"] = date,
                    ["note"] = note,
                };
                if (receiptId is not null)
                    entry["receipt"] = Link(receiptId);
                entries.Add(entry);
            }
        );

    protected Task RemoveEntryAsync(string token, string id) =>
        SaveLedgerAsync(
            token,
            ledger =>
            {
                var entries = ledger["transactions"]!.AsArray();
                entries.Remove(entries.Single(entry => entry!["id"]!.GetValue<string>() == id));
            }
        );

    protected static JsonObject Link(string receiptId) =>
        new()
        {
            ["id"] = receiptId,
            ["name"] = "receipt",
            ["mime"] = "application/pdf",
            ["uri"] = "/api/receipts/" + receiptId,
        };

    protected async Task<ReceiptTextRow?> TextRowAsync(string receiptId)
    {
        await using var command = Fixture.Admin.CreateCommand(
            "SELECT status, method, engine, content, search_text, pages, failure, attempts, due_at, extracted_at,"
                + " (SELECT count(*) FROM penny.receipt_text_chunks c WHERE c.receipt_id = t.receipt_id)"
                + " FROM penny.receipt_texts t WHERE receipt_id = $1"
        );
        command.Parameters.AddWithValue(receiptId);
        await using var reader = await command.ExecuteReaderAsync(Ct);
        if (!await reader.ReadAsync(Ct))
            return null;
        return new(
            reader.GetString(0),
            reader.IsDBNull(1) ? null : reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetString(2),
            reader.GetString(3),
            reader.GetString(4),
            reader.IsDBNull(5) ? null : reader.GetInt32(5),
            reader.IsDBNull(6) ? null : reader.GetString(6),
            reader.GetInt32(7),
            reader.IsDBNull(8) ? null : reader.GetFieldValue<DateTimeOffset>(8),
            reader.IsDBNull(9) ? null : reader.GetFieldValue<DateTimeOffset>(9),
            reader.GetInt64(10)
        );
    }

    protected async Task<ReceiptTextRow> TextOfAsync(string receiptId) =>
        await TextRowAsync(receiptId)
        ?? throw new ShouldAssertException($"Receipt {receiptId} has no text row.");

    protected sealed record ReceiptTextRow(
        string Status,
        string? Method,
        string? Engine,
        string Content,
        string SearchText,
        int? Pages,
        string? Failure,
        int Attempts,
        DateTimeOffset? DueAt,
        DateTimeOffset? ExtractedAt,
        long Chunks
    );
}
