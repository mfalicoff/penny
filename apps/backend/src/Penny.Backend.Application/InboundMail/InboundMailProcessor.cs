using System.Diagnostics;
using System.Security.Cryptography;
using Penny.Backend.Application.Abstractions.InboundMail;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Diagnostics;

namespace Penny.Backend.Application.InboundMail;

// The inbound mail worker's pass (MAZ-184, docs/plans/email-receipts.md#2-parsing-inbound-mail-worker):
// claim pending messages with a lease, convert each within its deadline, and store the
// result atomically. A renderer outage is retried with backoff; anything else about
// the message is recorded as a rejection reason and never retried.
public sealed class InboundMailProcessor(
    IInboundMailQueue queue,
    IInboundMailConverter converter,
    IReceiptInboxRepository inbox,
    InboundMailSettings settings,
    InboundMailProcessingSettings processing,
    TimeProvider clock
)
{
    public const string Rejected = "rejected";
    public const string Failed = "failed";

    public async Task<int> RunOnceAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        await queue.SweepAsync(
            now,
            processing.RawRetention,
            processing.MaxAttempts,
            cancellationToken
        );
        // Unhandled inbox items past their deadline are discarded (unlinked files deleted).
        await inbox.ExpireAsync(
            now,
            TimeSpan.FromDays(settings.InboxRetentionDays),
            cancellationToken
        );
        var (waiting, unhandled) = await queue.BacklogAsync(cancellationToken);
        BackendTelemetry.InboundMailBacklog(waiting, unhandled);
        var token = RandomNumberGenerator.GetHexString(32, lowercase: true);
        var work = await queue.ClaimAsync(
            token,
            now,
            now + processing.Lease,
            processing.Concurrency,
            processing.MaxAttempts,
            cancellationToken
        );
        if (work.Count == 0)
            return 0;
        using var activity = BackendTelemetry.StartJob(BackendTelemetry.InboundMailJob, work.Count);
        foreach (var item in work)
            BackendTelemetry.JobPickedUp(BackendTelemetry.InboundMailJob, now - item.DueAt);
        await Task.WhenAll(work.Select(item => ProcessAsync(token, item, cancellationToken)));
        return work.Count;
    }

    // Runs passes until nothing is due (tests and maintenance).
    public async Task<long> CatchUpAsync(CancellationToken cancellationToken)
    {
        long total = 0;
        int claimed;
        while ((claimed = await RunOnceAsync(cancellationToken)) > 0)
            total += claimed;
        return total;
    }

    private async Task ProcessAsync(
        string token,
        InboundWork work,
        CancellationToken cancellationToken
    )
    {
        var started = Stopwatch.GetTimestamp();
        var outcome = await ConvertAndStoreAsync(token, work, cancellationToken);
        BackendTelemetry.InboundMailProcessed(outcome, Stopwatch.GetElapsedTime(started));
    }

    private async Task<string> ConvertAndStoreAsync(
        string token,
        InboundWork work,
        CancellationToken cancellationToken
    )
    {
        var opened = await queue.OpenAsync(work, cancellationToken);
        if (opened is null)
        {
            await queue.FinishAsync(
                work,
                token,
                Failed,
                MailRejectReason.Unreadable,
                null,
                clock.GetUtcNow(),
                cancellationToken
            );
            return MailRejectReason.Unreadable;
        }
        MailConversion conversion;
        using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
        {
            deadline.CancelAfter(processing.MessageTimeout);
            try
            {
                conversion = await converter.ConvertAsync(
                    opened.Raw,
                    opened.AllowedSenders,
                    deadline.Token
                );
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                conversion = MailConversion.Reject(
                    MailRejectReason.Timeout,
                    MailAuthentication.Missing
                );
            }
            catch (MailRendererUnavailableException)
            {
                var now = clock.GetUtcNow();
                if (work.Attempts >= processing.MaxAttempts)
                {
                    await queue.FinishAsync(
                        work,
                        token,
                        Failed,
                        MailRejectReason.RenderUnavailable,
                        null,
                        now,
                        cancellationToken
                    );
                    return MailRejectReason.RenderUnavailable;
                }
                await queue.RetryAsync(
                    work,
                    token,
                    now + processing.Backoff(work.Attempts),
                    cancellationToken
                );
                return "retry";
            }
            finally
            {
                CryptographicOperations.ZeroMemory(opened.Raw);
            }
        }
        var finished = clock.GetUtcNow();
        if (conversion.Rejected)
        {
            await queue.FinishAsync(
                work,
                token,
                Rejected,
                conversion.RejectReason!,
                conversion.Authentication,
                finished,
                cancellationToken
            );
            return conversion.RejectReason!;
        }
        return await queue.CompleteAsync(
            work,
            token,
            conversion,
            finished,
            finished.AddDays(settings.InboxRetentionDays),
            cancellationToken
        )
            ? "done"
            : "lease_lost";
    }
}
