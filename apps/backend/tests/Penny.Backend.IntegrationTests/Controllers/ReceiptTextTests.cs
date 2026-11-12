using Microsoft.Extensions.DependencyInjection;
using Penny.Backend.Application.Abstractions.Receipts;
using Penny.Backend.Application.Receipts;
using Penny.Backend.IntegrationTests.Infrastructure;
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
        done.Attempts.ShouldBe(1);
        flaky.Calls.ShouldBe(2);
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
