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
// store (legacy server/http/receipts.ts, MAZ-60): byte checksums for every format,
// legacy messages, headers, owner and household access, and partial-write failures.
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
    public async Task whenReceiptDownloaded_Download_ShouldSendLegacyHeaders()
    {
        var token = await RegisterAsync("owner@example.test");
        var id = (await UploadedAsync(token, "Café 東京 (1)!*'~.pdf", "application/pdf", Pdf()))
            .GetProperty("id")
            .GetString()!;

        using var response = await DownloadAsync(token, id);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        // encodeURIComponent keeps ! * ' ( ) ~ and escapes spaces and UTF-8 bytes.
        response
            .Content.Headers.GetValues("Content-Disposition")
            .Single()
            .ShouldBe("inline; filename*=UTF-8''Caf%C3%A9%20%E6%9D%B1%E4%BA%AC%20(1)!*'~.pdf");
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
    public async Task whenBase64IsUnpaddedOrHasDanglingBits_Upload_ShouldDecodeLikeNode()
    {
        var token = await RegisterAsync("owner@example.test");
        // 1024 bytes encode to 1368 characters ending in "=": drop the padding.
        var content = Pdf(1024);
        var unpadded = Convert.ToBase64String(content).TrimEnd('=');
        unpadded.Length.ShouldBe(1366);
        using var response = await UploadAsync(
            token,
            new
            {
                name = "a.pdf",
                mime = "application/pdf",
                base64 = unpadded,
            }
        );
        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var id = JsonDocument
            .Parse(await response.Content.ReadAsStringAsync(Ct))
            .RootElement.GetProperty("id")
            .GetString()!;
        (await DownloadedAsync(token, id)).ShouldBe(content);

        // A dangling sixth-bit character is ignored, as Buffer.from does.
        var exact = Pdf(1026);
        var dangling = Convert.ToBase64String(exact) + "Q";
        using var withDangling = await UploadAsync(
            token,
            new
            {
                name = "b.pdf",
                mime = "application/pdf",
                base64 = dangling,
            }
        );
        withDangling.StatusCode.ShouldBe(HttpStatusCode.Created);
        var danglingId = JsonDocument
            .Parse(await withDangling.Content.ReadAsStringAsync(Ct))
            .RootElement.GetProperty("id")
            .GetString()!;
        (await DownloadedAsync(token, danglingId)).ShouldBe(exact);
    }

    [Fact]
    public async Task whenUploadIsInvalid_Upload_ShouldRejectWithLegacyMessagesAndStoreNothing()
    {
        var token = await RegisterAsync("owner@example.test");
        var pdf = Convert.ToBase64String(Pdf());
        object Body(
            string name = "a.pdf",
            string mime = "application/pdf",
            string? base64 = null
        ) =>
            new
            {
                name,
                mime,
                base64 = base64 ?? pdf,
            };

        // Schema failures (zod): missing, mistyped or out-of-range fields.
        foreach (
            var body in new object[]
            {
                new { },
                new { mime = "application/pdf", base64 = pdf },
                new { name = "a.pdf", base64 = pdf },
                new { name = "a.pdf", mime = "application/pdf" },
                new
                {
                    name = 1,
                    mime = "application/pdf",
                    base64 = pdf,
                },
                new
                {
                    name = "a.pdf",
                    mime = "application/pdf",
                    base64 = 1,
                },
                Body(name: ""),
                Body(name: new string('n', 256)),
                Body(mime: "image/svg+xml"),
                Body(mime: "APPLICATION/PDF"),
                Body(base64: ""),
                Body(base64: "===="),
                Body(base64: pdf + "="),
                Body(base64: "JVBE Ri0x"),
                Body(base64: "JVBERi0x\n"),
                Body(base64: "JVBERi0x-_"),
                Body(base64: "JV=BERi0x"),
            }
        )
            await ShouldFailAsync(
                UploadAsync(token, body),
                HttpStatusCode.BadRequest,
                ReceiptService.InvalidUpload
            );
        // A name of 255 UTF-16 units is accepted; a lone surrogate is not storable.
        (await UploadedAsync(token, new string('n', 255), "application/pdf", Pdf()))
            .GetProperty("name")
            .GetString()!
            .Length.ShouldBe(255);
        await ShouldFailAsync(
            UploadRawAsync(
                token,
                $$"""{"name":"\ud800.pdf","mime":"application/pdf","base64":"{{pdf}}"}"""
            ),
            HttpStatusCode.BadRequest,
            ReceiptService.InvalidUpload
        );
        // Non-JSON bodies are "no body"; malformed JSON is the parser's 400.
        await ShouldFailAsync(
            UploadRawAsync(token, "name=a.pdf", "application/x-www-form-urlencoded"),
            HttpStatusCode.BadRequest,
            ReceiptService.InvalidUpload
        );
        await ShouldFailAsync(
            UploadRawAsync(token, "[]"),
            HttpStatusCode.BadRequest,
            ReceiptService.InvalidUpload
        );
        await ShouldFailAsync(
            UploadRawAsync(token, "{\"name\":"),
            HttpStatusCode.BadRequest,
            "Invalid JSON."
        );
        await ShouldFailAsync(
            UploadRawAsync(token, "\"a.pdf\""),
            HttpStatusCode.BadRequest,
            "Invalid JSON."
        );

        // Decoded content: signatures must match the declared type and size must be
        // 1 byte to 10 MB.
        var png = EveryFormat().Single(format => format.Mime == "image/png").Content;
        foreach (
            var body in new[]
            {
                Body(base64: Convert.ToBase64String("not a pdf"u8.ToArray())),
                Body(mime: "image/jpeg", base64: Convert.ToBase64String(png)),
                Body(mime: "image/gif", base64: Convert.ToBase64String("GIF88a----"u8.ToArray())),
                Body(mime: "image/webp", base64: Convert.ToBase64String("RIFF0000WEB"u8.ToArray())),
                Body(
                    mime: "image/heic",
                    base64: Convert.ToBase64String("0000ftyx0000"u8.ToArray())
                ),
                Body(mime: "image/png", base64: Convert.ToBase64String(png.AsSpan(0, 7).ToArray())),
                Body(base64: "Q"),
                Body(base64: "JQ=="),
            }
        )
            await ShouldFailAsync(
                UploadAsync(token, body),
                HttpStatusCode.BadRequest,
                ReceiptService.UnsupportedFile
            );

        (await CountAsync("SELECT count(*) FROM penny.receipts")).ShouldBe(1L);
        StoredFiles().Count.ShouldBe(1);
        await ShouldFailAsync(
            UploadAsync(null, Body()),
            HttpStatusCode.Unauthorized,
            AuthService.SignInRequired
        );
    }

    [Fact]
    public async Task whenUploadsApproachTheLimits_Upload_ShouldEnforceDecodedAndRequestSizes()
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

        await ShouldFailAsync(
            UploadAsync(
                token,
                new
                {
                    name = "too-large.pdf",
                    mime = "application/pdf",
                    base64 = Convert.ToBase64String(Pdf(ReceiptFormat.MaxBytes + 1)),
                },
                client
            ),
            HttpStatusCode.BadRequest,
            ReceiptService.UnsupportedFile
        );
        // Base64 text beyond 14 MiB characters fails the schema before decoding.
        await ShouldFailAsync(
            UploadAsync(
                token,
                new
                {
                    name = "too-long.pdf",
                    mime = "application/pdf",
                    base64 = "JVBE" + new string('A', ReceiptFormat.MaxBase64Length - 3),
                },
                client
            ),
            HttpStatusCode.BadRequest,
            ReceiptService.InvalidUpload
        );
        // A body over the request limit is refused before it is read.
        await ShouldFailAsync(
            UploadAsync(
                token,
                new
                {
                    name = "huge.pdf",
                    mime = "application/pdf",
                    base64 = new string('A', 20 * 1024 * 1024),
                },
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
            UploadAsync(
                token,
                new
                {
                    name = "a.pdf",
                    mime = "application/pdf",
                    base64 = Convert.ToBase64String(Pdf()),
                }
            ),
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
                UploadAsync(
                    token,
                    new
                    {
                        name = "a.pdf",
                        mime = "application/pdf",
                        base64 = Convert.ToBase64String(Pdf()),
                    }
                ),
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
