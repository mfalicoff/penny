using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Application.Households;
using Penny.Backend.Application.Ledgers;
using Penny.Backend.Application.Receipts;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Receipt upload and download over real HTTP and PostgreSQL with the encrypted file
// store (MAZ-60): byte checksums for every format,
// contract messages, headers, owner and household access, and partial-write failures.
// All data is synthetic.
public sealed partial class ReceiptTests(ApiFixture fixture) : ReceiptTestBase(fixture)
{
    private const string GenericFailure = "The server could not complete this request.";

    [Fact]
    public async Task whenEachSupportedFormatUploaded_ReceiptFlow_ShouldDownloadIdenticalBytes()
    {
        var token = await RegisterAsync("owner@example.test");
        var second = await LoginAsync("owner@example.test");
        foreach (var (mime, content) in EveryFormat())
        {
            var uploaded = await UploadedAsync(token, "Reçu été.bin", mime, content);
            var id = uploaded.GetProperty("id").GetString()!;
            HexId().IsMatch(id).ShouldBeTrue(id);
            uploaded.GetProperty("name").GetString().ShouldBe("Reçu été.bin");
            uploaded.GetProperty("mime").GetString().ShouldBe(mime);
            uploaded.GetProperty("uri").GetString().ShouldBe("/api/receipts/" + id);
            uploaded.EnumerateObject().Count().ShouldBe(4);

            // Another session of the same account reads the plaintext bytes.
            using var response = await DownloadAsync(second, id);
            response.StatusCode.ShouldBe(HttpStatusCode.OK);
            response.Content.Headers.ContentType!.ToString().ShouldBe(mime);
            Sha256(await response.Content.ReadAsByteArrayAsync(Ct)).ShouldBe(Sha256(content));

            // At rest: ciphertext under a random path, never the plaintext or the name.
            var stored = await File.ReadAllBytesAsync(
                Path.Combine(Fixture.ReceiptRoot, await StoragePathAsync(id)),
                Ct
            );
            stored.Length.ShouldBe(content.Length + 16);
            stored.AsSpan(0, 8).SequenceEqual(content.AsSpan(0, 8)).ShouldBeFalse();
            (
                await CountAsync(
                    $"SELECT count(*) FROM penny.receipts WHERE id = '{id}' AND size_bytes = {content.Length} AND mime = '{mime}' AND encryption_version = 1"
                )
            ).ShouldBe(1L);
        }
        StoredFiles().ShouldAllBe(path => !path.Contains("Re"));
    }

    [Fact]
    public async Task whenReceiptDownloaded_Download_ShouldSendContractHeaders()
    {
        var token = await RegisterAsync("owner@example.test");
        var id = (await UploadedAsync(token, "Café 東京 (1)!*'~.pdf", "application/pdf", Pdf()))
            .GetProperty("id")
            .GetString()!;

        using var response = await DownloadAsync(token, id);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        // RFC 8187: only unreserved characters stay literal, UTF-8 bytes as %XX.
        response
            .Content.Headers.GetValues("Content-Disposition")
            .Single()
            .ShouldBe(
                "inline; filename*=UTF-8''Caf%C3%A9%20%E6%9D%B1%E4%BA%AC%20%281%29%21%2A%27~.pdf"
            );
        response
            .Headers.GetValues("Content-Security-Policy")
            .Single()
            .ShouldBe("default-src 'none'; sandbox");
        response.Headers.CacheControl!.NoStore.ShouldBeTrue();
        response.Headers.GetValues("X-Content-Type-Options").Single().ShouldBe("nosniff");
        response.Content.Headers.ContentType!.ToString().ShouldBe("application/pdf");
        response.Content.Headers.ContentLength.ShouldBe(Pdf().Length);
    }

    [Fact]
    public async Task whenHeadersUseOtherValidForms_Upload_ShouldStoreTheNameAndType()
    {
        var token = await RegisterAsync("owner@example.test");
        // encodeURIComponent leaves ' ( ) * ! literal; media types are case-insensitive
        // and their parameters are ignored.
        using var response = await UploadAsync(
            token,
            "attachment; filename*=UTF-8''Re%C3%A7u%20(1)!*'.pdf",
            "Application/PDF; charset=binary",
            Pdf()
        );
        var text = await response.Content.ReadAsStringAsync(Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.Created, text);
        var uploaded = JsonDocument.Parse(text).RootElement;
        uploaded.GetProperty("name").GetString().ShouldBe("Reçu (1)!*'.pdf");
        uploaded.GetProperty("mime").GetString().ShouldBe("application/pdf");
        (await DownloadedAsync(token, uploaded.GetProperty("id").GetString()!)).ShouldBe(Pdf());
    }

    [Fact]
    public async Task whenUploadIsInvalid_Upload_ShouldRejectWithContractMessagesAndStoreNothing()
    {
        var token = await RegisterAsync("owner@example.test");
        var pdf = Pdf();

        // Header failures: a missing, malformed or out-of-range name, or a type that is
        // not an accepted receipt type.
        foreach (
            var (disposition, mime) in new (string?, string?)[]
            {
                (null, "application/pdf"),
                ("attachment", "application/pdf"),
                ("attachment; filename=a.pdf", "application/pdf"),
                ("attachment; filename*=UTF-8''a b.pdf", "application/pdf"),
                ("attachment; filename*=ISO-8859-1''a.pdf", "application/pdf"),
                (Disposition(""), "application/pdf"),
                (Disposition(new string('n', 256)), "application/pdf"),
                // NUL is not storable; an encoded lone surrogate is not UTF-8.
                ("attachment; filename*=UTF-8''%00.pdf", "application/pdf"),
                ("attachment; filename*=UTF-8''%ED%A0%80.pdf", "application/pdf"),
                (Disposition("a.pdf"), null),
                (Disposition("a.pdf"), "image/svg+xml"),
                (Disposition("a.pdf"), "application/octet-stream"),
                (Disposition("a.pdf"), "not a type"),
            }
        )
            await ShouldFailAsync(
                UploadAsync(token, disposition, mime, pdf),
                HttpStatusCode.BadRequest,
                ReceiptService.InvalidUpload
            );
        // A name of 255 UTF-16 units is accepted.
        (await UploadedAsync(token, new string('n', 255), "application/pdf", pdf))
            .GetProperty("name")
            .GetString()!
            .Length.ShouldBe(255);
        // An app from before MAZ-131 sending the base64 JSON body is told to update.
        await ShouldFailAsync(
            UploadRawAsync(
                token,
                $$"""{"name":"a.pdf","mime":"application/pdf","base64":"{{Convert.ToBase64String(pdf)}}"}"""
            ),
            HttpStatusCode.BadRequest,
            ReceiptService.OutdatedClient
        );

        // Content: signatures must match the declared type and size must be 1 byte to
        // 10 MiB.
        var png = EveryFormat().Single(format => format.Mime == "image/png").Content;
        foreach (
            var (mime, content) in new (string, byte[])[]
            {
                ("application/pdf", "not a pdf"u8.ToArray()),
                ("image/jpeg", png),
                ("image/gif", "GIF88a----"u8.ToArray()),
                ("image/webp", "RIFF0000WEB"u8.ToArray()),
                ("image/heic", "0000ftyx0000"u8.ToArray()),
                ("image/png", png.AsSpan(0, 7).ToArray()),
                ("application/pdf", []),
            }
        )
            await ShouldFailAsync(
                UploadAsync(token, Disposition("a.bin"), mime, content),
                HttpStatusCode.BadRequest,
                ReceiptService.UnsupportedFile
            );

        (await CountAsync("SELECT count(*) FROM penny.receipts")).ShouldBe(1L);
        StoredFiles().Count.ShouldBe(1);
        await ShouldFailAsync(
            UploadAsync(null, Disposition("a.pdf"), "application/pdf", pdf),
            HttpStatusCode.Unauthorized,
            AuthService.SignInRequired
        );
    }

    [Fact]
    public async Task whenUploadsApproachTheLimits_Upload_ShouldEnforceFileAndRequestSizes()
    {
        // The production request limit (20 MB); the shared host uses 64 KB.
        await using var factory = new TestApiFactory(
            Fixture.RuntimeConnection,
            new Dictionary<string, string>
            {
                ["Backend:MaxRequestBodyBytes"] = (20 * 1024 * 1024).ToString(
                    System.Globalization.CultureInfo.InvariantCulture
                ),
                ["Receipts:Root"] = Fixture.ReceiptRoot,
                ["Receipts:MasterKey"] = Fixture.ReceiptKey,
            }
        );
        using var client = CreateClient(factory);
        var token = await RegisterAsync("owner@example.test", client);

        var largest = Pdf(ReceiptFormat.MaxBytes);
        var id = (await UploadedAsync(token, "large.pdf", "application/pdf", largest, client))
            .GetProperty("id")
            .GetString()!;
        using (var download = await DownloadAsync(token, id, client))
        {
            download.StatusCode.ShouldBe(HttpStatusCode.OK);
            Sha256(await download.Content.ReadAsByteArrayAsync(Ct)).ShouldBe(Sha256(largest));
        }

        // One byte over the file limit, with a declared length and chunked: the body is
        // read to the end and refused with the file message.
        var larger = Pdf(ReceiptFormat.MaxBytes + 1);
        await ShouldFailAsync(
            UploadAsync(token, Disposition("too-large.pdf"), "application/pdf", larger, client),
            HttpStatusCode.BadRequest,
            ReceiptService.UnsupportedFile
        );
        using (var chunked = Authorized(HttpMethod.Post, "/api/receipts", bearer: token))
        {
            chunked.Headers.TransferEncodingChunked = true;
            chunked.Content = new StreamContent(new MemoryStream(larger));
            chunked.Content.Headers.ContentType = new("application/pdf");
            chunked.Content.Headers.TryAddWithoutValidation(
                "Content-Disposition",
                Disposition("chunked.pdf")
            );
            await ShouldFailAsync(
                client.SendAsync(chunked, Ct),
                HttpStatusCode.BadRequest,
                ReceiptService.UnsupportedFile
            );
        }
        // A body over the request limit is refused before it is read.
        await ShouldFailAsync(
            UploadAsync(
                token,
                Disposition("huge.pdf"),
                "application/pdf",
                Pdf(20 * 1024 * 1024 + 1),
                client
            ),
            HttpStatusCode.RequestEntityTooLarge,
            "The upload is too large."
        );
        (await CountAsync("SELECT count(*) FROM penny.receipts")).ShouldBe(1L);
    }

    [Fact]
    public async Task whenReceiptIsNotVisible_Download_ShouldAnswerNotFound()
    {
        var owner = await RegisterAsync("owner@example.test");
        var other = await RegisterAsync("other@example.test");
        var id = (await UploadedAsync(owner, "a.pdf", "application/pdf", Pdf()))
            .GetProperty("id")
            .GetString()!;

        foreach (
            var (token, receiptId) in new[]
            {
                (other, id),
                (owner, "missing"),
                (owner, id.ToUpperInvariant()),
                (owner, new string('a', 500)),
            }
        )
            await ShouldFailAsync(
                DownloadAsync(token, receiptId),
                HttpStatusCode.NotFound,
                ReceiptService.NotFound
            );
        await ShouldFailAsync(
            DownloadAsync(null, id),
            HttpStatusCode.Unauthorized,
            AuthService.SignInRequired
        );
    }

    [Fact]
    public async Task whenHouseholdMembershipChanges_Download_ShouldFollowSharedAccess()
    {
        At(Noon);
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        var (cam, camId) = await AccountAsync("cam@example.test");
        var (outsider, _) = await AccountAsync("outsider@example.test");
        var home = Id(await CreateHouseholdAsync(alex));
        await AdmitAsync(home, alex, bea);
        await AdmitAsync(home, alex, cam);
        var first = Pdf(2000);
        var firstId = (await UploadedAsync(alex, "first.pdf", "application/pdf", first))
            .GetProperty("id")
            .GetString()!;
        var secondId = (await UploadedAsync(alex, "second.pdf", "application/pdf", Pdf(3000)))
            .GetProperty("id")
            .GetString()!;

        // Uploading alone shares nothing.
        (await DownloadStatusAsync(bea, firstId)).ShouldBe(HttpStatusCode.NotFound);

        // Linked to a live expense: every current member reads it, outsiders do not.
        var expense = await CreateExpenseAsync(
            home,
            alex,
            Expense(
                9000,
                alexId,
                extra: new
                {
                    receiptId = firstId,
                    splitMode = "exact",
                    allocations = new[]
                    {
                        new { userId = alexId, amountCents = 9000L },
                        new { userId = beaId, amountCents = 0L },
                        new { userId = camId, amountCents = 0L },
                    },
                }
            )
        );
        Sha256(await DownloadedAsync(bea, firstId)).ShouldBe(Sha256(first));
        Sha256(await DownloadedAsync(cam, firstId)).ShouldBe(Sha256(first));
        (await DownloadStatusAsync(outsider, firstId)).ShouldBe(HttpStatusCode.NotFound);

        // A former member keeps the receipts of expenses they have a share in, but not
        // those recorded after they left.
        await ExpectAsync(HttpMethod.Post, $"/api/households/{home}/leave", bea, HttpStatusCode.OK);
        (await DownloadStatusAsync(bea, firstId)).ShouldBe(HttpStatusCode.OK);
        await CreateExpenseAsync(
            home,
            alex,
            Expense(1200, alexId, extra: new { receiptId = secondId })
        );
        (await DownloadStatusAsync(bea, secondId)).ShouldBe(HttpStatusCode.NotFound);
        (await DownloadStatusAsync(cam, secondId)).ShouldBe(HttpStatusCode.OK);

        // Deleting the expense withdraws shared access; the owner keeps the file.
        await ExpectAsync(
            HttpMethod.Delete,
            ExpensePath(home, Id(expense)),
            alex,
            HttpStatusCode.OK,
            new { revision = 0 }
        );
        (await DownloadStatusAsync(bea, firstId)).ShouldBe(HttpStatusCode.NotFound);
        (await DownloadStatusAsync(cam, firstId)).ShouldBe(HttpStatusCode.NotFound);
        (await DownloadStatusAsync(alex, firstId)).ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenReceiptBelongsToSomeoneElse_Attachment_ShouldBeRefused()
    {
        At(Noon);
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        var home = Id(await CreateHouseholdAsync(alex));
        await AdmitAsync(home, alex, bea);
        var id = (await UploadedAsync(alex, "a.pdf", "application/pdf", Pdf()))
            .GetProperty("id")
            .GetString()!;

        // Not in bea's personal ledger, nor in a household where it is not linked.
        var snapshot = await GetLedgerAsync(bea);
        snapshot["ledger"]!["transactions"]!
            .AsArray()
            .Add(
                new JsonObject
                {
                    ["id"] = "lunch",
                    ["title"] = "Synthetic lunch",
                    ["kind"] = "expense",
                    ["total"] = 1000,
                    ["share"] = 1000,
                    ["categoryId"] = snapshot["ledger"]!["categories"]![0]![
                        "id"
                    ]!.GetValue<string>(),
                    ["date"] = "2026-09-28",
                    ["note"] = "",
                    ["receipt"] = new JsonObject
                    {
                        ["id"] = id,
                        ["name"] = "a.pdf",
                        ["mime"] = "application/pdf",
                        ["uri"] = "/api/receipts/" + id,
                    },
                }
            );
        await ShouldFailAsync(
            PutLedgerAsync(bea, snapshot),
            HttpStatusCode.BadRequest,
            LedgerService.ForeignReceipt
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            ExpensesPath(home),
            bea,
            HttpStatusCode.BadRequest,
            SharedExpenseService.ReceiptUnavailable,
            Expense(1000, beaId, extra: new { receiptId = id })
        );
        (await DownloadStatusAsync(bea, id)).ShouldBe(HttpStatusCode.NotFound);
        // Once alex shares it, bea can read it and attach it within that household.
        await CreateExpenseAsync(home, alex, Expense(1000, alexId, extra: new { receiptId = id }));
        (await DownloadStatusAsync(bea, id)).ShouldBe(HttpStatusCode.OK);
        await CreateExpenseAsync(home, bea, Expense(1000, beaId, extra: new { receiptId = id }));
    }

    [Fact]
    public async Task whenMetadataWriteFails_Upload_ShouldRemoveTheFile()
    {
        var token = await RegisterAsync("owner@example.test");
        await Fixture.SqlAsync("REVOKE INSERT ON penny.receipts FROM penny_runtime", Ct);
        await ShouldFailAsync(
            UploadAsync(token, Disposition("a.pdf"), "application/pdf", Pdf()),
            HttpStatusCode.InternalServerError,
            GenericFailure
        );
        (await CountAsync("SELECT count(*) FROM penny.receipts")).ShouldBe(0L);
        StoredFiles().ShouldBeEmpty();
    }

    [Fact]
    public async Task whenFileWriteFails_Upload_ShouldStoreNoMetadata()
    {
        var token = await RegisterAsync("owner@example.test");
        // A plain file where the receipt root should be: no directory can be created.
        await File.WriteAllTextAsync(Fixture.ReceiptRoot, "not a directory", Ct);
        try
        {
            await ShouldFailAsync(
                UploadAsync(token, Disposition("a.pdf"), "application/pdf", Pdf()),
                HttpStatusCode.InternalServerError,
                GenericFailure
            );
            (await CountAsync("SELECT count(*) FROM penny.receipts")).ShouldBe(0L);
        }
        finally
        {
            File.Delete(Fixture.ReceiptRoot);
        }
    }

    [Fact]
    public async Task whenStoredFileIsMissingOrTampered_Download_ShouldFailWithoutBytes()
    {
        var token = await RegisterAsync("owner@example.test");
        var missing = (await UploadedAsync(token, "a.pdf", "application/pdf", Pdf()))
            .GetProperty("id")
            .GetString()!;
        var tampered = (await UploadedAsync(token, "b.pdf", "application/pdf", Pdf()))
            .GetProperty("id")
            .GetString()!;
        File.Delete(Path.Combine(Fixture.ReceiptRoot, await StoragePathAsync(missing)));
        var path = Path.Combine(Fixture.ReceiptRoot, await StoragePathAsync(tampered));
        var bytes = await File.ReadAllBytesAsync(path, Ct);
        bytes[10] ^= 1;
        await File.WriteAllBytesAsync(path, bytes, Ct);

        foreach (var id in new[] { missing, tampered })
        {
            using var response = await DownloadAsync(token, id);
            response.StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
            response.Content.Headers.ContentType!.MediaType.ShouldBe("application/json");
            response.Content.Headers.Contains("Content-Disposition").ShouldBeFalse();
            JsonDocument
                .Parse(await response.Content.ReadAsStringAsync(Ct))
                .RootElement.GetProperty("error")
                .GetString()
                .ShouldBe(GenericFailure);
        }
    }

    private async Task<string> LoginAsync(string email)
    {
        using var response = await Client.PostAsJsonAsync(
            "/api/auth/login",
            new { email, password = TestPassword },
            Ct
        );
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<JsonElement>(Ct))
            .GetProperty("token")
            .GetString()!;
    }

    [GeneratedRegex("^[0-9a-f]{32}$")]
    private static partial Regex HexId();
}
