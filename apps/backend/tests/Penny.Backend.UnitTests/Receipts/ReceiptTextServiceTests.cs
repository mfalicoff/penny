using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Abstractions.Receipts;
using Penny.Backend.Application.Receipts;
using Penny.Backend.UnitTests.Search;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Receipts;

public sealed class ReceiptTextServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 11, 12, 0, 0, TimeSpan.Zero);

    private sealed class Outbox : IReceiptTextRepository
    {
        public List<ReceiptTextWork> Due { get; } = [];
        public byte[] Content { get; set; } = "%PDF-1.7 synthetic"u8.ToArray();
        public List<ReceiptTextResult> Completed { get; } = [];
        public List<(string Id, DateTimeOffset RetryAt, string Failure)> Retried { get; } = [];
        public int Reads { get; private set; }

        public Task<IReadOnlyList<ReceiptTextWork>> ClaimAsync(
            string leaseToken,
            DateTimeOffset now,
            DateTimeOffset leaseUntil,
            int limit,
            int maxAttempts,
            string engine,
            CancellationToken cancellationToken
        )
        {
            var claimed = Due.Take(limit).ToList();
            Due.RemoveRange(0, claimed.Count);
            return Task.FromResult<IReadOnlyList<ReceiptTextWork>>(claimed);
        }

        public Task<byte[]> ReadContentAsync(string receiptId, CancellationToken cancellationToken)
        {
            Reads++;
            return Task.FromResult(Content);
        }

        public Task<bool> CompleteAsync(
            string leaseToken,
            ReceiptTextResult result,
            CancellationToken cancellationToken
        )
        {
            Completed.Add(result);
            return Task.FromResult(true);
        }

        public Task RetryAsync(
            string leaseToken,
            string receiptId,
            DateTimeOffset retryAt,
            string failure,
            CancellationToken cancellationToken
        )
        {
            Retried.Add((receiptId, retryAt, failure));
            return Task.CompletedTask;
        }

        public Task<ReceiptTextQueueReport> QueueAsync(
            string? userId,
            bool all,
            string engine,
            CancellationToken cancellationToken
        ) => throw new NotSupportedException();

        public Task<ReceiptTextStatusReport> StatusAsync(
            string? userId,
            string engine,
            CancellationToken cancellationToken
        ) => throw new NotSupportedException();
    }

    private sealed class FakeEngine(Func<CancellationToken, Task<ReceiptExtraction>> extract)
        : IReceiptTextExtractor
    {
        public byte[]? Seen { get; private set; }

        public string Engine => "fake 1.0 (eng)";

        public bool Supports(string mime) => mime != "image/heic";

        public async Task<ReceiptExtraction> ExtractAsync(
            string mime,
            ReadOnlyMemory<byte> content,
            int maxPages,
            CancellationToken cancellationToken
        )
        {
            Seen = content.ToArray();
            return await extract(cancellationToken);
        }
    }

    private static ReceiptTextWork Work(
        string mime = "application/pdf",
        long size = 100,
        int attempts = 1
    ) => new("r1", mime, size, attempts, DateTimeOffset.UnixEpoch);

    private static ReceiptTextService Service(
        Outbox outbox,
        IReceiptTextExtractor engine,
        ReceiptTextSettings? settings = null
    ) =>
        new(
            outbox,
            engine,
            new DeterministicEmbedder(),
            settings ?? ReceiptTextSettings.Default,
            new ManualClock(Now)
        );

    [Fact]
    public async Task whenExtractionSucceeds_RunOnce_ShouldStoreCleanTextChunksAndZeroTheBuffer()
    {
        var outbox = new Outbox();
        outbox.Due.Add(Work());
        var engine = new FakeEngine(_ =>
            Task.FromResult(new ReceiptExtraction("  CAFÉ   Olimpico \n\n Latte 5.25 ", "text", 1))
        );
        (await Service(outbox, engine).RunOnceAsync(CancellationToken.None)).ShouldBe(1);
        var result = outbox.Completed.ShouldHaveSingleItem();
        result.Status.ShouldBe(ReceiptTextStatus.Done);
        result.Method.ShouldBe("text");
        result.Engine.ShouldBe("fake 1.0 (eng)");
        result.Content.ShouldBe("CAFÉ Olimpico\nLatte 5.25");
        result.SearchText.ShouldBe("cafe olimpico latte 5.25");
        result.Chunks.ShouldBe(["CAFÉ Olimpico\nLatte 5.25"]);
        result.ExtractedAt.ShouldBe(Now);
        engine.Seen.ShouldNotBeNull();
        // The decrypted bytes do not outlive the job.
        outbox.Content.ShouldAllBe(value => value == 0);
    }

    [Fact]
    public async Task whenImageTruncated_RunOnce_ShouldStoreTheTextAndRecordTheTruncation()
    {
        var outbox = new Outbox();
        outbox.Due.Add(Work("image/png", attempts: 2));
        var engine = new FakeEngine(_ =>
            Task.FromResult(new ReceiptExtraction("TOP OF A VERY LONG RECEIPT", "ocr", 1, true))
        );
        await Service(outbox, engine).RunOnceAsync(CancellationToken.None);
        var result = outbox.Completed.ShouldHaveSingleItem();
        result.Status.ShouldBe(ReceiptTextStatus.Done);
        result.Failure.ShouldBe(ReceiptTextFailure.Truncated);
        result.Content.ShouldBe("TOP OF A VERY LONG RECEIPT");
        // Attempts made, this one included (the claim counted it).
        result.Attempts.ShouldBe(2);
    }

    [Fact]
    public async Task whenFileUnsupportedOrTooLarge_RunOnce_ShouldNeverReadOrRetryIt()
    {
        var outbox = new Outbox();
        outbox.Due.Add(Work("image/heic"));
        outbox.Due.Add(Work(size: 11 * 1024 * 1024));
        var engine = new FakeEngine(_ => throw new InvalidOperationException("not called"));
        await Service(outbox, engine, ReceiptTextSettings.Default with { Concurrency = 2 })
            .RunOnceAsync(CancellationToken.None);
        outbox.Reads.ShouldBe(0);
        outbox.Retried.ShouldBeEmpty();
        outbox
            .Completed.Select(result => result.Failure)
            .Order()
            .ShouldBe([ReceiptTextFailure.TooLarge, ReceiptTextFailure.UnsupportedFormat]);
        outbox.Completed.ShouldAllBe(result => result.Status == ReceiptTextStatus.Unsupported);
        // Never attempted: the claim's count is not kept.
        outbox.Completed.ShouldAllBe(result => result.Attempts == 0);
    }

    [Fact]
    public async Task whenEngineIsTooSlow_RunOnce_ShouldCancelItAndRetryWithBackoff()
    {
        var outbox = new Outbox();
        outbox.Due.Add(Work(attempts: 3));
        var engine = new FakeEngine(async token =>
        {
            await Task.Delay(TimeSpan.FromMinutes(5), token);
            return new ReceiptExtraction("", "ocr", 1);
        });
        await Service(
                outbox,
                engine,
                ReceiptTextSettings.Default with
                {
                    Timeout = TimeSpan.FromMilliseconds(50),
                }
            )
            .RunOnceAsync(CancellationToken.None);
        var retry = outbox.Retried.ShouldHaveSingleItem();
        retry.Failure.ShouldBe(ReceiptTextFailure.Timeout);
        retry.RetryAt.ShouldBe(Now + TimeSpan.FromMinutes(2));
        outbox.Completed.ShouldBeEmpty();
    }

    [Fact]
    public async Task whenLastAttemptFails_RunOnce_ShouldFailTheReceipt()
    {
        var outbox = new Outbox();
        outbox.Due.Add(Work(attempts: 4));
        var engine = new FakeEngine(_ =>
            throw new ReceiptExtractionException(ReceiptTextFailure.Corrupt)
        );
        await Service(outbox, engine).RunOnceAsync(CancellationToken.None);
        outbox.Retried.ShouldBeEmpty();
        var failed = outbox.Completed.ShouldHaveSingleItem();
        failed.Status.ShouldBe(ReceiptTextStatus.Failed);
        failed.Failure.ShouldBe(ReceiptTextFailure.Corrupt);
        failed.Attempts.ShouldBe(4);
        failed.Content.ShouldBeEmpty();
    }
}
