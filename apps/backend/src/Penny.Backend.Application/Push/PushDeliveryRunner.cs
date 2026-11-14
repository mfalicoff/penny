using System.Security.Cryptography;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Diagnostics;

namespace Penny.Backend.Application.Push;

// Delivers the household notification outbox (MAZ-61) safely with
// any number of runners and restarts:
//
// 1. Claim: one short transaction leases up to BatchSize due outbox messages to a
//    fresh token. A lease expires after Lease, so a crashed runner's messages are
//    taken over; while a runner holds a message's lease it alone touches its
//    deliveries.
// 2. Prepare (per message, one transaction): expire messages older than MaxAge, plan
//    deliveries on first use (the recipient's devices with live sessions), finish
//    deliveries whose device was removed, transferred or logged out, and take the due
//    ones, counting the attempt before anything is sent.
// 3. Send: messages are grouped by provider (APNs) and sent; each outcome is a redacted
//    reason code.
// 4. Record (per message, one transaction): accepted, retry with exponential backoff
//    (5 s doubling to 1 h, or the provider's longer Retry-After), permanent, or
//    invalid token (the device is deleted unless it re-registered after the claim,
//    and every pending delivery to it finishes). Then the message settles and its
//    lease is released.
//
// Delivery is at least once: a crash or lost lease between send and record resends
// on takeover. The APNs collapse id (the outbox id) lets iOS replace such duplicates.
public sealed class PushDeliveryRunner(
    IPushRepository outbox,
    IEnumerable<IPushTransport> transports,
    TimeProvider clock
)
{
    public const int BatchSize = 25;
    public const int MaxDevicesPerMessage = 20;
    public const int MaxPasses = 1000;
    public static readonly TimeSpan Lease = TimeSpan.FromMinutes(2);

    // Messages older than this finish undelivered (`expired`); APNs gets the same
    // expiration so it drops undelivered notifications too.
    public static readonly TimeSpan MaxAge = TimeSpan.FromHours(24);
    public static readonly TimeSpan RetryBase = TimeSpan.FromSeconds(5);
    public static readonly TimeSpan RetryMax = TimeSpan.FromHours(1);

    // Identifies this process in `lease_owner` for diagnostics; never authorization.
    public static readonly string Owner = $"{Environment.MachineName}/{Environment.ProcessId}";

    private readonly Dictionary<string, IPushTransport> byProvider = transports.ToDictionary(
        transport => transport.Provider,
        StringComparer.Ordinal
    );

    public static DateTimeOffset RetryAt(DateTimeOffset now, int attempts, TimeSpan? retryAfter)
    {
        var exponent = Math.Min(10, Math.Max(0, attempts - 1));
        var backoff = TimeSpan.FromTicks(Math.Min(RetryMax.Ticks, RetryBase.Ticks << exponent));
        if (retryAfter is { } requested && requested > backoff)
            backoff = requested < RetryMax ? requested : RetryMax;
        return now + backoff;
    }

    public async Task<PushRun> RunOnceAsync(CancellationToken cancellationToken)
    {
        var token = RandomNumberGenerator.GetHexString(32, lowercase: true);
        var claimedAt = clock.GetUtcNow();
        var claims = await outbox.ClaimAsync(
            Owner,
            token,
            claimedAt,
            claimedAt + Lease,
            BatchSize,
            cancellationToken
        );
        var failures = new List<string>();
        var planned = new List<(PushClaim Claim, IReadOnlyList<PushDispatch> Dispatches)>();
        using var activity =
            claims.Count > 0
                ? BackendTelemetry.StartJob(BackendTelemetry.PushDeliveryJob, claims.Count)
                : null;
        foreach (var claim in claims)
        {
            BackendTelemetry.JobPickedUp(
                BackendTelemetry.PushDeliveryJob,
                claimedAt - claim.CreatedAt
            );
            try
            {
                var now = clock.GetUtcNow();
                var dispatches = await outbox.PrepareAsync(
                    claim.OutboxId,
                    token,
                    now,
                    now + Lease,
                    now - MaxAge,
                    MaxDevicesPerMessage,
                    cancellationToken
                );
                if (dispatches is { Count: > 0 })
                    planned.Add((claim, dispatches));
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                failures.Add(error.GetType().Name);
            }
        }

        var outcomes = await SendAsync(planned, cancellationToken);
        int accepted = 0,
            retried = 0,
            failed = 0,
            invalid = 0;
        foreach (var (claim, dispatches) in planned)
        {
            var now = clock.GetUtcNow();
            var results = dispatches
                .Select(dispatch =>
                {
                    var outcome = outcomes[(dispatch.OutboxId, dispatch.Token)];
                    return new PushDeliveryResult(
                        dispatch.Token,
                        outcome.Kind,
                        outcome.Reason,
                        outcome.TicketId,
                        outcome.Kind == PushOutcomeKind.Retry
                            ? RetryAt(now, dispatch.Attempts, outcome.RetryAfter)
                            : null
                    );
                })
                .ToList();
            try
            {
                await outbox.RecordAsync(
                    claim.OutboxId,
                    token,
                    results,
                    now,
                    claimedAt,
                    cancellationToken
                );
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                failures.Add(error.GetType().Name);
                continue;
            }
            foreach (var result in results)
            {
                switch (result.Kind)
                {
                    case PushOutcomeKind.Accepted:
                        accepted++;
                        break;
                    case PushOutcomeKind.Retry:
                        retried++;
                        break;
                    case PushOutcomeKind.Permanent:
                        failed++;
                        break;
                    case PushOutcomeKind.InvalidToken:
                        invalid++;
                        break;
                }
            }
        }
        if (failures.Count > 0)
            BackendTelemetry.Failed(activity, failures[0]);
        return new(claims.Count, accepted, retried, failed, invalid, failures);
    }

    // Passes until nothing is claimable (tests and maintenance); returns accepted sends.
    public async Task<int> RunUntilIdleAsync(CancellationToken cancellationToken)
    {
        var total = 0;
        for (var pass = 0; pass < MaxPasses; pass++)
        {
            var run = await RunOnceAsync(cancellationToken);
            total += run.Accepted;
            if (run.Claimed == 0 || run.Failures.Count > 0)
                break;
        }
        return total;
    }

    private async Task<Dictionary<(string, string), PushOutcome>> SendAsync(
        List<(PushClaim Claim, IReadOnlyList<PushDispatch> Dispatches)> planned,
        CancellationToken cancellationToken
    )
    {
        var outcomes = new Dictionary<(string, string), PushOutcome>();
        var ready = new Dictionary<string, List<(PushDispatch Dispatch, PushMessage Message)>>(
            StringComparer.Ordinal
        );
        foreach (var (claim, dispatches) in planned)
        {
            var payload = PushPayload.Parse(claim.PayloadJson);
            var content = PushContent.For(claim.EventType);
            foreach (var dispatch in dispatches)
            {
                var key = (dispatch.OutboxId, dispatch.Token);
                if (payload is null || content is not { } text)
                {
                    outcomes[key] = PushOutcome.Permanent("invalid-payload");
                    continue;
                }
                if (!byProvider.ContainsKey(dispatch.Provider))
                {
                    // Configuration can be fixed without losing messages younger than MaxAge.
                    outcomes[key] = PushOutcome.Retry($"{dispatch.Provider}:not-configured");
                    continue;
                }
                if (!ready.TryGetValue(dispatch.Provider, out var batch))
                    ready[dispatch.Provider] = batch = [];
                batch.Add(
                    (
                        dispatch,
                        new PushMessage(
                            dispatch.OutboxId,
                            dispatch.Token,
                            dispatch.Environment,
                            text.Title,
                            text.Body,
                            payload,
                            claim.CreatedAt + MaxAge
                        )
                    )
                );
            }
        }
        foreach (var (provider, batch) in ready)
        {
            IReadOnlyList<PushOutcome>? sent;
            try
            {
                sent = await byProvider[provider]
                    .SendAsync([.. batch.Select(item => item.Message)], cancellationToken);
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                sent = null;
            }
            for (var index = 0; index < batch.Count; index++)
            {
                var dispatch = batch[index].Dispatch;
                outcomes[(dispatch.OutboxId, dispatch.Token)] =
                    sent is not null && sent.Count == batch.Count
                        ? sent[index]
                        : PushOutcome.Retry($"{provider}:transport-error");
            }
        }
        return outcomes;
    }
}
