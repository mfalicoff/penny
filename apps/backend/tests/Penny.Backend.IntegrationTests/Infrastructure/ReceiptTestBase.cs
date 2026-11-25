using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Shouldly;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// HTTP helpers for the receipt suites (MAZ-60): synthetic files with valid signatures
// for every accepted MIME type, uploads and downloads. All data is synthetic.
public abstract class ReceiptTestBase(ApiFixture fixture) : SharedExpenseTestBase(fixture)
{
    // Every byte value after the signature, so checksums cover the full range.
    protected static byte[] Synthetic(ReadOnlySpan<byte> signature, int length = 1024)
    {
        var bytes = new byte[Math.Max(length, signature.Length)];
        for (var index = 0; index < bytes.Length; index++)
            bytes[index] = (byte)(index * 7);
        signature.CopyTo(bytes);
        return bytes;
    }

    protected static byte[] Pdf(int length = 1024) => Synthetic("%PDF-1.7\n"u8, length);

    // One synthetic file per accepted MIME type.
    protected static IReadOnlyList<(string Mime, byte[] Content)> EveryFormat() =>
        [
            ("application/pdf", Pdf()),
            ("image/jpeg", Synthetic([0xFF, 0xD8, 0xFF, 0xE0])),
            ("image/png", Synthetic([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])),
            ("image/webp", Synthetic([.. "RIFF"u8, 0x10, 0, 0, 0, .. "WEBPVP8 "u8])),
            ("image/gif", Synthetic("GIF89a"u8)),
            ("image/gif", Synthetic("GIF87a"u8)),
            ("image/heic", Synthetic([0, 0, 0, 0x18, .. "ftypheic"u8])),
            ("image/heif", Synthetic([0, 0, 0, 0x18, .. "ftypmif1"u8])),
        ];

    protected static string Sha256(byte[] content) =>
        Convert.ToHexStringLower(SHA256.HashData(content));

    // `POST /api/receipts` with the file as the body (MAZ-131). Null `mime` or
    // `disposition` leaves that header out.
    protected Task<HttpResponseMessage> UploadAsync(
        string? token,
        string? disposition,
        string? mime,
        byte[] content,
        HttpClient? client = null
    )
    {
        var request = Authorized(HttpMethod.Post, "/api/receipts", bearer: token);
        request.Content = new ByteArrayContent(content);
        if (mime is not null)
            request.Content.Headers.TryAddWithoutValidation("Content-Type", mime).ShouldBeTrue();
        if (disposition is not null)
            request
                .Content.Headers.TryAddWithoutValidation("Content-Disposition", disposition)
                .ShouldBeTrue();
        return (client ?? Client).SendAsync(request, Ct);
    }

    protected Task<HttpResponseMessage> UploadRawAsync(
        string? token,
        string content,
        string mediaType = "application/json"
    )
    {
        var request = Authorized(HttpMethod.Post, "/api/receipts", bearer: token);
        request.Content = new StringContent(content, Encoding.UTF8, mediaType);
        return Client.SendAsync(request, Ct);
    }

    // Uploads and returns the `{id, name, mime, uri}` response.
    protected async Task<JsonElement> UploadedAsync(
        string token,
        string name,
        string mime,
        byte[] content,
        HttpClient? client = null
    )
    {
        using var response = await UploadAsync(token, Disposition(name), mime, content, client);
        var text = await response.Content.ReadAsStringAsync(Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.Created, text);
        return JsonDocument.Parse(text).RootElement.Clone();
    }

    protected Task<HttpResponseMessage> DownloadAsync(
        string? token,
        string id,
        HttpClient? client = null
    ) =>
        (client ?? Client).SendAsync(
            Authorized(HttpMethod.Get, "/api/receipts/" + Uri.EscapeDataString(id), bearer: token),
            Ct
        );

    // Downloads and returns the bytes, expecting success.
    protected async Task<byte[]> DownloadedAsync(string token, string id)
    {
        using var response = await DownloadAsync(token, id);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return await response.Content.ReadAsByteArrayAsync(Ct);
    }

    protected async Task<HttpStatusCode> DownloadStatusAsync(string token, string id)
    {
        using var response = await DownloadAsync(token, id);
        return response.StatusCode;
    }

    protected static async Task ShouldFailAsync(
        Task<HttpResponseMessage> request,
        HttpStatusCode status,
        string message,
        string? code = null
    )
    {
        using var response = await request;
        var text = await response.Content.ReadAsStringAsync(Ct);
        response.StatusCode.ShouldBe(status, text);
        var root = JsonDocument.Parse(text).RootElement;
        root.GetProperty("error").GetString().ShouldBe(message);
        var actual = root.GetProperty("code").GetString();
        ErrorCodeCatalog.ShouldBeKnown(actual);
        if (code is not null)
            actual.ShouldBe(code);
    }

    // Files in the receipt root, relative to it (none when the root does not exist).
    protected List<string> StoredFiles() =>
        Directory.Exists(Fixture.ReceiptRoot)
            ?
            [
                .. Directory
                    .EnumerateFiles(Fixture.ReceiptRoot, "*", SearchOption.AllDirectories)
                    .Select(path => Path.GetRelativePath(Fixture.ReceiptRoot, path)),
            ]
            : [];

    protected async Task<string> StoragePathAsync(string receiptId) =>
        (string)
            (
                await ScalarAsync(
                    $"SELECT storage_path FROM penny.receipts WHERE id = '{receiptId}'"
                )
            )!;
}
