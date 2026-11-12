using Microsoft.Extensions.DependencyInjection;
using Penny.Backend.Api.Configuration;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Abstractions.Receipts;
using Penny.Backend.Application.Receipts;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Receipts;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Receipt text extraction (MAZ-125) on real PostgreSQL with the real local engine
// (poppler and Tesseract) and synthetic receipts generated per test.
public sealed class ReceiptTextTests(ApiFixture fixture) : ReceiptTextTestBase(fixture)
{
    private static readonly string[] Lines =
    [
        "FROMAGERIE LECLERC",
        "Gruyere 250 g 8.49",
        "Baguette tradition 3.25",
        "TOTAL 11.74",
    ];

    [Fact]
    public async Task whenTextPdfUploaded_Extraction_ShouldReadItsEmbeddedTextWithoutOcr()
    {
        var (token, _) = await AccountAsync("pdf@example.test");
        var id = await UploadReceiptAsync(
            token,
            "receipt.pdf",
            "application/pdf",
            SyntheticReceipts.TextPdf([.. Lines, "Merci de votre visite, à bientôt!"])
        );
        // The upload committed without waiting: the text is only queued.
        var queued = await TextOfAsync(id);
        queued.Status.ShouldBe(ReceiptTextStatus.Pending);
        queued.DueAt.ShouldNotBeNull();

        (await ExtractAsync()).ShouldBe(1);
        var text = await TextOfAsync(id);
        text.Status.ShouldBe(ReceiptTextStatus.Done);
        text.Method.ShouldBe("text");
        text.Pages.ShouldBe(1);
        text.Engine!.ShouldStartWith("tesseract ");
        text.Engine.ShouldContain("(eng+fra)");
        text.Engine.ShouldContain("; poppler ");
        text.ExtractedAt.ShouldNotBeNull();
        text.DueAt.ShouldBeNull();
        text.Content.ShouldContain("FROMAGERIE LECLERC");
        text.Content.ShouldContain("Merci de votre visite, à bientôt!");
        text.SearchText.ShouldContain("merci de votre visite, a bientot!");
        text.Chunks.ShouldBe(1);
        // Nothing is left to do, and no plaintext file was written to the store.
        (await ExtractAsync()).ShouldBe(0);
        Directory
            .EnumerateFiles(Fixture.ReceiptRoot, "*", SearchOption.AllDirectories)
            .Count()
            .ShouldBe(1);
    }

    [Fact]
    public async Task whenPhotosAndScansUploaded_Extraction_ShouldReadThemWithOcr()
    {
        var (_, userId) = await AccountAsync("photo@example.test");
        var jpeg = await StoreReceiptAsync(
            userId,
            "a.jpg",
            "image/jpeg",
            SyntheticReceipts.Jpeg(Lines)
        );
        var png = await StoreReceiptAsync(
            userId,
            "b.png",
            "image/png",
            SyntheticReceipts.Png(Lines)
        );
        var scan = await StoreReceiptAsync(
            userId,
            "c.pdf",
            "application/pdf",
            SyntheticReceipts.ScannedPdf(Lines)
        );
        var mixed = await StoreReceiptAsync(
            userId,
            "d.pdf",
            "application/pdf",
            SyntheticReceipts.TextPdfPages(
                ["Quincaillerie Centre-Ville, facture numero 2026-118", "Marteau et clous 16.49"],
                ["Page deux"]
            )
        );
        await TextsWith(Limits with { Concurrency = 2 }).CatchUpAsync(Ct);
        foreach (var id in new[] { jpeg, png, scan })
        {
            var text = await TextOfAsync(id);
            text.Status.ShouldBe(ReceiptTextStatus.Done, id);
            text.Method.ShouldBe("ocr");
            text.SearchText.ShouldContain("fromagerie leclerc");
            text.SearchText.ShouldContain("baguette");
            text.Chunks.ShouldBe(1);
        }
        // The second page has too little embedded text, so it is OCRed too.
        var both = await TextOfAsync(mixed);
        both.Method.ShouldBe("mixed");
        both.Pages.ShouldBe(2);
        both.SearchText.ShouldContain("quincaillerie");
        both.SearchText.ShouldContain("page deux");
    }

    [Fact]
    public async Task whenFileUnsupportedOrTooLarge_Extraction_ShouldMarkItUnsupportedWithoutRetry()
    {
        var (_, userId) = await AccountAsync("unsupported@example.test");
        var heic = await StoreReceiptAsync(
            userId,
            "a.heic",
            "image/heic",
            [0, 0, 0, 0x18, .. "ftypheic"u8, .. new byte[64]]
        );
        var large = await StoreReceiptAsync(
            userId,
            "big.pdf",
            "application/pdf",
            SyntheticReceipts.TextPdf([.. Lines, new string('x', 3000)])
        );
        await TextsWith(Limits with { MaxBytes = 3000 }).CatchUpAsync(Ct);
        var unsupported = await TextOfAsync(heic);
        unsupported.Status.ShouldBe(ReceiptTextStatus.Unsupported);
        unsupported.Failure.ShouldBe(ReceiptTextFailure.UnsupportedFormat);
        unsupported.Engine.ShouldNotBeNull();
        unsupported.Content.ShouldBeEmpty();
        var tooLarge = await TextOfAsync(large);
        tooLarge.Status.ShouldBe(ReceiptTextStatus.Unsupported);
        tooLarge.Failure.ShouldBe(ReceiptTextFailure.TooLarge);
        tooLarge.Attempts.ShouldBe(0);
        (await ExtractAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task whenPdfHasManyPages_Extraction_ShouldReadOnlyTheConfiguredPages()
    {
        var (_, userId) = await AccountAsync("pages@example.test");
        var id = await StoreReceiptAsync(
            userId,
            "long.pdf",
            "application/pdf",
            SyntheticReceipts.TextPdfPages([
                .. Enumerable
                    .Range(1, 4)
                    .Select(page =>
                        new[] { $"Statement page {page} of the synthetic monthly account summary" }
                    ),
            ])
        );
        await TextsWith(Limits with { MaxPages = 2 }).CatchUpAsync(Ct);
        var text = await TextOfAsync(id);
        text.Status.ShouldBe(ReceiptTextStatus.Done);
        text.Pages.ShouldBe(2);
        text.Content.ShouldContain("page 2 of");
        text.Content.ShouldNotContain("page 3 of");
    }

    [Fact]
    public async Task whenFileCorrupt_Extraction_ShouldRetryWithBackoffThenFail()
    {
        var (_, userId) = await AccountAsync("corrupt@example.test");
        At(Noon);
        var pdf = await StoreReceiptAsync(
            userId,
            "broken.pdf",
            "application/pdf",
            [.. "%PDF-1.7\n"u8, .. Enumerable.Repeat((byte)'x', 500)]
        );
        var png = await StoreReceiptAsync(
            userId,
            "broken.png",
            "image/png",
            [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, .. Enumerable.Repeat((byte)7, 500)]
        );
        var texts = TextsWith(Limits with { MaxAttempts = 2, Concurrency = 2 });
        (await texts.RunOnceAsync(Ct)).ShouldBe(2);
        foreach (var id in new[] { pdf, png })
        {
            var retry = await TextOfAsync(id);
            retry.Status.ShouldBe(ReceiptTextStatus.Pending);
            retry.Attempts.ShouldBe(1);
            retry.Failure.ShouldBe(ReceiptTextFailure.Corrupt);
            retry.DueAt.ShouldBe(Noon + ReceiptTextService.Backoff(0));
        }
        // Not due before the backoff passes.
        (await texts.RunOnceAsync(Ct)).ShouldBe(0);
        At(Noon + TimeSpan.FromSeconds(30));
        (await texts.CatchUpAsync(Ct)).ShouldBe(2);
        foreach (var id in new[] { pdf, png })
        {
            var failed = await TextOfAsync(id);
            failed.Status.ShouldBe(ReceiptTextStatus.Failed);
            failed.Attempts.ShouldBe(2);
            failed.Failure.ShouldBe(ReceiptTextFailure.Corrupt);
            failed.DueAt.ShouldBeNull();
            failed.ExtractedAt.ShouldBe(Noon + TimeSpan.FromSeconds(30));
        }
        ReceiptTextService.Backoff(1).ShouldBe(TimeSpan.FromMinutes(1));
        ReceiptTextService.Backoff(30).ShouldBe(ReceiptTextService.MaxBackoff);
    }

    [Fact]
    public async Task whenEngineFailsOnce_Extraction_ShouldSucceedOnRetry()
    {
        var (_, userId) = await AccountAsync("flaky@example.test");
        At(Noon);
        var id = await StoreReceiptAsync(
            userId,
            "receipt.pdf",
            "application/pdf",
            SyntheticReceipts.TextPdf(Lines)
        );
        var flaky = new FlakyReceiptTextExtractor(
            Fixture.Factory.Services.GetRequiredService<IReceiptTextExtractor>(),
            1
        );
        var texts = TextsWith(Limits, flaky);
        await texts.RunOnceAsync(Ct);
        (await TextOfAsync(id)).Failure.ShouldBe(ReceiptTextFailure.EngineError);
        At(Noon + TimeSpan.FromMinutes(1));
        await texts.RunOnceAsync(Ct);
        var done = await TextOfAsync(id);
        done.Status.ShouldBe(ReceiptTextStatus.Done);
        // Attempts made: the failed one and the one that succeeded.
        done.Attempts.ShouldBe(2);
        flaky.Calls.ShouldBe(2);
    }

    [Fact]
    public async Task whenWorkerDiesDuringEveryAttempt_Claim_ShouldFailTheReceiptInsteadOfRetryingForever()
    {
        var (_, userId) = await AccountAsync("crash@example.test");
        At(Noon);
        var id = await StoreReceiptAsync(
            userId,
            "bomb.pdf",
            "application/pdf",
            SyntheticReceipts.TextPdf(Lines)
        );
        var repository = Fixture.Factory.Services.GetRequiredService<IReceiptTextRepository>();
        var settings = Limits with { MaxAttempts = 2 };
        var now = Noon;
        // Each claim's worker dies (an engine takes the process down, the host's OOM
        // killer): nothing completes or retries, the lease just expires.
        for (var attempt = 1; attempt <= 2; attempt++)
        {
            var work = await repository.ClaimAsync(
                "worker-" + attempt,
                now,
                now + settings.Lease,
                10,
                settings.MaxAttempts,
                "engine",
                Ct
            );
            work.ShouldHaveSingleItem().Attempts.ShouldBe(attempt);
            (await TextOfAsync(id)).Attempts.ShouldBe(attempt);
            // Still leased: another worker cannot take it.
            (
                await repository.ClaimAsync(
                    "other",
                    now + TimeSpan.FromSeconds(1),
                    now + settings.Lease,
                    10,
                    settings.MaxAttempts,
                    "engine",
                    Ct
                )
            ).ShouldBeEmpty();
            now += settings.Lease + TimeSpan.FromSeconds(1);
        }
        At(now);
        // The next pass finds the last attempt abandoned and fails the receipt.
        (await TextsWith(settings).RunOnceAsync(Ct)).ShouldBe(0);
        var failed = await TextOfAsync(id);
        failed.Status.ShouldBe(ReceiptTextStatus.Failed);
        failed.Failure.ShouldBe(ReceiptTextFailure.LeaseExpired);
        failed.Attempts.ShouldBe(2);
        failed.DueAt.ShouldBeNull();
        failed.ExtractedAt.ShouldBe(now);
        failed.Engine.ShouldNotBeNull();
        (await TextsWith(settings).CatchUpAsync(Ct)).ShouldBe(0);
    }

    [Fact]
    public async Task whenReceiptReextracted_Extraction_ShouldKeepTheEmbeddingsOfUnchangedChunks()
    {
        var (token, userId) = await AccountAsync("rerun@example.test");
        var id = await StoreReceiptAsync(
            userId,
            "long.pdf",
            "application/pdf",
            SyntheticReceipts.TextPdf(Lines)
        );
        await SaveEntryAsync(token, "long", "Groceries", id);
        // Long enough for several chunks; the second run changes only the last line.
        var lines = Enumerable
            .Range(1, 400)
            .Select(line => $"Article numero {line} pommes poires fromage pain")
            .ToList();
        var first = new FixedTextExtractor(string.Join('\n', lines));
        await TextsWith(Limits, first).CatchUpAsync(Ct);
        await CatchUpAsync();
        var before = await ChunksAsync(id);
        before.Count.ShouldBeGreaterThan(2);
        before.ShouldAllBe(chunk => chunk.Embedded && !chunk.Due);

        lines[^1] = "TOTAL 99.99 merci";
        await Fixture.SqlAsync(
            $"UPDATE penny.receipt_texts SET status = 'pending', due_at = TIMESTAMPTZ '1970-01-01 00:00:00+00', attempts = 0 WHERE receipt_id = '{id}'",
            Ct
        );
        await TextsWith(Limits, new FixedTextExtractor(string.Join('\n', lines))).CatchUpAsync(Ct);
        var after = await ChunksAsync(id);
        after.Count.ShouldBe(before.Count);
        // Unchanged passages keep their row and embedding; only the last is re-queued.
        after.SkipLast(1).ShouldBe(before.SkipLast(1));
        after[^1].Id.ShouldNotBe(before[^1].Id);
        after[^1].Embedded.ShouldBeFalse();
        after[^1].Due.ShouldBeTrue();
        await CatchUpAsync();
        (await ChunksAsync(id)).ShouldAllBe(chunk => chunk.Embedded && !chunk.Due);
    }

    private async Task<List<(long Id, int Ordinal, bool Embedded, bool Due)>> ChunksAsync(
        string receiptId
    )
    {
        await using var command = Fixture.Admin.CreateCommand(
            "SELECT id, ordinal, embedding IS NOT NULL, embedding_due_at IS NOT NULL FROM penny.receipt_text_chunks WHERE receipt_id = $1 ORDER BY ordinal"
        );
        command.Parameters.AddWithValue(receiptId);
        await using var reader = await command.ExecuteReaderAsync(Ct);
        var chunks = new List<(long, int, bool, bool)>();
        while (await reader.ReadAsync(Ct))
            chunks.Add(
                (reader.GetInt64(0), reader.GetInt32(1), reader.GetBoolean(2), reader.GetBoolean(3))
            );
        return chunks;
    }

    // The real engine under a tight memory and CPU limit: decoding or rendering any of
    // the inputs below at full size would need gigabytes and be killed.
    private LocalReceiptTextExtractor BoundedEngine(long megabytes = 512)
    {
        var engine = Fixture.Factory.Services.GetRequiredService<OcrOptions>().Engine;
        return new(
            engine with
            {
                Limits = OperatingSystem.IsLinux()
                    ? new("prlimit", megabytes * 1024 * 1024, 60)
                    : null,
            }
        );
    }

    [Fact]
    public async Task whenEngineExceedsItsMemoryLimit_Extraction_ShouldCountTheAttemptAndEndFailed()
    {
        Assert.SkipUnless(OperatingSystem.IsLinux(), "prlimit limits are Linux only.");
        var (_, userId) = await AccountAsync("limit@example.test");
        At(Noon);
        var id = await StoreReceiptAsync(
            userId,
            "scan.pdf",
            "application/pdf",
            SyntheticReceipts.ScannedPdf(Lines)
        );
        // Enough for poppler, too little for Tesseract to hold the page.
        var texts = TextsWith(Limits with { MaxAttempts = 2 }, BoundedEngine(120));
        await texts.RunOnceAsync(Ct);
        var retry = await TextOfAsync(id);
        retry.Status.ShouldBe(ReceiptTextStatus.Pending);
        retry.Failure.ShouldBe(ReceiptTextFailure.ResourceLimit);
        retry.Attempts.ShouldBe(1);
        At(Noon + TimeSpan.FromMinutes(1));
        await texts.CatchUpAsync(Ct);
        var failed = await TextOfAsync(id);
        failed.Status.ShouldBe(ReceiptTextStatus.Failed);
        failed.Failure.ShouldBe(ReceiptTextFailure.ResourceLimit);
        failed.Attempts.ShouldBe(2);
    }

    [Fact]
    public async Task whenInputsDeclareHugeDimensions_Extraction_ShouldReadThemWithBoundedMemory()
    {
        var (_, userId) = await AccountAsync("bomb@example.test");
        // 100 × 100 inches: 30000 × 30000 pixels at 300 dpi.
        var hugePage = await StoreReceiptAsync(
            userId,
            "page.pdf",
            "application/pdf",
            SyntheticReceipts.ScannedPdfPage(7200, 7200, (0, 0, 7200, 7200, Lines))
        );
        var hugePng = SyntheticReceipts.Png(30000, 30000);
        hugePng.Length.ShouldBeLessThan(2 * 1024 * 1024);
        var bomb = await StoreReceiptAsync(userId, "huge.png", "image/png", hugePng);
        var started = System.Diagnostics.Stopwatch.StartNew();
        await TextsWith(Limits with { Timeout = TimeSpan.FromSeconds(60) }, BoundedEngine())
            .CatchUpAsync(Ct);
        started.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(60));
        var page = await TextOfAsync(hugePage);
        page.Status.ShouldBe(ReceiptTextStatus.Done, page.Failure);
        page.Method.ShouldBe("ocr");
        page.SearchText.ShouldContain("fromagerie leclerc");
        var png = await TextOfAsync(bomb);
        png.Status.ShouldBe(ReceiptTextStatus.Done, png.Failure);
        png.Failure.ShouldBeNull();
    }

    [Fact]
    public async Task whenReceiptIsVeryTall_Extraction_ShouldReadItInStripsTopToBottom()
    {
        var (_, userId) = await AccountAsync("tall@example.test");
        string[] top = ["EPICERIE DU MARCHE", "Pommes Cortland 4.49"];
        string[] bottom = ["SOUS-TOTAL 31.17", "Merci et a bientot"];
        // 1700 × 12000 pixels: four strips, the bottom text in the third.
        var image = await StoreReceiptAsync(
            userId,
            "tall.png",
            "image/png",
            SyntheticReceipts.Png(1700, 12000, (0, top), (9000, bottom))
        );
        // Three letter pages tall: rendered in strips, never as one bitmap.
        var page = await StoreReceiptAsync(
            userId,
            "tall.pdf",
            "application/pdf",
            SyntheticReceipts.ScannedPdfPage(
                612,
                2376,
                (0, 1584, 612, 792, top),
                (0, 0, 612, 792, bottom)
            )
        );
        // 1700 × 30000 pixels is past the pixel ceiling: the top is read, the rest cut.
        var cut = await StoreReceiptAsync(
            userId,
            "cut.png",
            "image/png",
            SyntheticReceipts.Png(1700, 30000, (0, top), (27000, bottom))
        );
        await TextsWith(Limits with { Concurrency = 3 }, BoundedEngine()).CatchUpAsync(Ct);
        foreach (var id in new[] { image, page })
        {
            var text = await TextOfAsync(id);
            text.Status.ShouldBe(ReceiptTextStatus.Done, text.Failure);
            text.Failure.ShouldBeNull();
            text.SearchText.ShouldContain("epicerie du marche");
            text.SearchText.ShouldContain("merci et a bientot");
            text.SearchText.IndexOf("epicerie", StringComparison.Ordinal)
                .ShouldBeLessThan(text.SearchText.IndexOf("merci", StringComparison.Ordinal));
        }
        var truncated = await TextOfAsync(cut);
        truncated.Status.ShouldBe(ReceiptTextStatus.Done);
        truncated.Failure.ShouldBe(ReceiptTextFailure.Truncated);
        truncated.SearchText.ShouldContain("epicerie du marche");
        truncated.SearchText.ShouldNotContain("merci");
    }

    [Fact]
    public async Task whenExtractionExceedsTimeLimit_Extraction_ShouldStopTheEngineAndRetry()
    {
        var (_, userId) = await AccountAsync("slow@example.test");
        At(Noon);
        var id = await StoreReceiptAsync(
            userId,
            "slow.jpg",
            "image/jpeg",
            SyntheticReceipts.Jpeg(Lines)
        );
        await TextsWith(Limits with { Timeout = TimeSpan.FromMilliseconds(20) }).RunOnceAsync(Ct);
        var timedOut = await TextOfAsync(id);
        timedOut.Status.ShouldBe(ReceiptTextStatus.Pending);
        timedOut.Failure.ShouldBe(ReceiptTextFailure.Timeout);
        timedOut.Attempts.ShouldBe(1);
    }

    [Fact]
    public async Task whenFileMissing_Extraction_ShouldRecordItUnreadable()
    {
        var (_, userId) = await AccountAsync("missing@example.test");
        var id = await StoreReceiptAsync(
            userId,
            "a.pdf",
            "application/pdf",
            SyntheticReceipts.TextPdf(Lines)
        );
        foreach (
            var file in Directory.EnumerateFiles(
                Fixture.ReceiptRoot,
                "*",
                SearchOption.AllDirectories
            )
        )
            File.Delete(file);
        await TextsWith(Limits with { MaxAttempts = 1 }).RunOnceAsync(Ct);
        var text = await TextOfAsync(id);
        text.Status.ShouldBe(ReceiptTextStatus.Failed);
        text.Failure.ShouldBe(ReceiptTextFailure.Unreadable);
    }

    [Fact]
    public async Task whenLanguageDataMissing_Host_ShouldFailAtStartup()
    {
        await using var host = new TestApiFactory(
            Fixture.RuntimeConnection,
            new Dictionary<string, string>
            {
                ["Ocr:Worker"] = "true",
                ["Ocr:Languages"] = "eng+zzz",
            }
        );
        var failure = Should.Throw<InvalidOperationException>(() => host.StartServer());
        failure.Message.ShouldContain("OCR language data is missing for zzz");
    }
}
