using System.Security.Cryptography;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Application.Diagnostics;
using Penny.Backend.Application.Households;

namespace Penny.Backend.Application.Mail;

// Delivers the mail outbox (MAZ-124) with any number of runners and restarts, like the
// push runner:
//
// 1. Claim: one short transaction leases up to BatchSize due messages to a fresh token;
//    a crashed runner's lease expires after Lease and another runner takes over.
// 2. Compose (per message): a message older than MaxAge, or out of attempts, fails as
//    `expired`. Otherwise its code is issued now (a password reset or email verification
//    code, or the invitation's code under the household lock) and the email rendered.
//    The code never reaches the database in clear, so a retry issues a new one and the
//    earlier email's code stops working.
// 3. Send: one SMTP connection for the batch.
// 4. Record (per message): sent, retry with backoff (30 s doubling to 1 h), permanent
//    failure or dropped (nothing to send any more), then the lease is released.
//
// Delivery is at least once: a crash between send and record resends on takeover, with a
// fresh code that replaces the first. Request handlers only write outbox rows, so a slow
// or failing mail server never blocks or rolls back the action that asked for the email.
public sealed class MailDeliveryRunner(
    IMailOutbox outbox,
    IMailTransport transport,
    PasswordResetMailService resets,
    EmailInviteService invites,
    EmailVerificationService verifications,
    TimeProvider clock
)
{
    public const int BatchSize = 10;
    public const int MaxAttempts = 8;
    public const int MaxPasses = 1000;
    public static readonly TimeSpan Lease = TimeSpan.FromMinutes(2);
    public static readonly TimeSpan MaxAge = TimeSpan.FromHours(24);
    public static readonly TimeSpan RetryBase = TimeSpan.FromSeconds(30);
    public static readonly TimeSpan RetryMax = TimeSpan.FromHours(1);

    // Finished messages are kept this long (the rate limits count the last 24 hours).
    public static readonly TimeSpan Retention = TimeSpan.FromDays(7);

    public static readonly string Owner = $"{Environment.MachineName}/{Environment.ProcessId}";

    public static DateTimeOffset RetryAt(DateTimeOffset now, int attempts)
    {
        var exponent = Math.Min(10, Math.Max(0, attempts - 1));
        return now + TimeSpan.FromTicks(Math.Min(RetryMax.Ticks, RetryBase.Ticks << exponent));
    }

    public async Task<MailRun> RunOnceAsync(CancellationToken cancellationToken)
    {
        var token = RandomNumberGenerator.GetHexString(32, lowercase: true);
        var claimedAt = clock.GetUtcNow();
        await outbox.PurgeAsync(claimedAt - Retention, cancellationToken);
        var claims = await outbox.ClaimAsync(
            Owner,
            token,
            claimedAt,
            claimedAt + Lease,
            BatchSize,
            cancellationToken
        );
        using var activity =
            claims.Count > 0
                ? BackendTelemetry.StartJob(BackendTelemetry.MailDeliveryJob, claims.Count)
                : null;
        var failures = new List<string>();
        var results = new Dictionary<string, MailOutcome>(StringComparer.Ordinal);
        var ready = new List<(MailClaim Claim, OutgoingMail Mail)>();
        foreach (var claim in claims)
        {
            BackendTelemetry.JobPickedUp(
                BackendTelemetry.MailDeliveryJob,
                claimedAt - claim.CreatedAt
            );
            if (claim.CreatedAt < claimedAt - MaxAge || claim.Attempts >= MaxAttempts)
            {
                results[claim.Id] = MailOutcome.Permanent("expired");
                continue;
            }
            try
            {
                var mail = claim.Kind switch
                {
                    MailKinds.PasswordReset => await resets.ComposeAsync(claim, cancellationToken),
                    MailKinds.HouseholdInvite => await invites.ComposeAsync(
                        claim,
                        cancellationToken
                    ),
                    MailKinds.EmailVerification => await verifications.ComposeAsync(
                        claim,
                        cancellationToken
                    ),
                    _ => null,
                };
                if (mail is null)
                    results[claim.Id] = MailOutcome.Dropped(
                        claim.Kind switch
                        {
                            MailKinds.PasswordReset => "account-gone",
                            MailKinds.EmailVerification => "already-verified",
                            _ => "invite-withdrawn",
                        }
                    );
                else
                    ready.Add((claim, mail));
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                failures.Add(error.GetType().Name);
                results[claim.Id] = MailOutcome.Retry("compose:" + error.GetType().Name);
            }
        }

        if (ready.Count > 0)
        {
            IReadOnlyList<MailOutcome>? sent;
            try
            {
                sent = await transport.SendAsync(
                    [.. ready.Select(item => item.Mail)],
                    cancellationToken
                );
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                failures.Add(error.GetType().Name);
                sent = null;
            }
            for (var index = 0; index < ready.Count; index++)
                results[ready[index].Claim.Id] =
                    sent is not null && sent.Count == ready.Count
                        ? sent[index]
                        : MailOutcome.Retry("smtp:transport-error");
        }

        var reasons = new SortedSet<string>(StringComparer.Ordinal);
        int delivered = 0,
            retried = 0,
            failed = 0,
            dropped = 0;
        foreach (var claim in claims)
        {
            var outcome = results[claim.Id];
            var now = clock.GetUtcNow();
            // The last attempt that fails temporarily fails for good.
            if (outcome.Kind == MailOutcomeKind.Retry && claim.Attempts + 1 >= MaxAttempts)
                outcome = MailOutcome.Permanent(outcome.Reason ?? "retry");
            try
            {
                await outbox.RecordAsync(
                    claim.Id,
                    token,
                    new MailResult(
                        outcome.Kind,
                        outcome.Reason,
                        outcome.Kind == MailOutcomeKind.Retry
                            ? RetryAt(now, claim.Attempts + 1)
                            : null
                    ),
                    now,
                    cancellationToken
                );
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                failures.Add(error.GetType().Name);
                continue;
            }
            switch (outcome.Kind)
            {
                case MailOutcomeKind.Sent:
                    delivered++;
                    break;
                case MailOutcomeKind.Retry:
                    retried++;
                    if (outcome.Reason is { } retryReason)
                        reasons.Add(retryReason);
                    break;
                case MailOutcomeKind.Permanent:
                    failed++;
                    if (outcome.Reason is { } failReason)
                        reasons.Add(failReason);
                    break;
                case MailOutcomeKind.Dropped:
                    dropped++;
                    break;
            }
        }
        if (failures.Count > 0)
            BackendTelemetry.Failed(activity, failures[0]);
        return new(claims.Count, delivered, retried, failed, dropped, failures, [.. reasons]);
    }

    // Passes until nothing is claimable (tests and maintenance); returns sent messages.
    public async Task<int> RunUntilIdleAsync(CancellationToken cancellationToken)
    {
        var total = 0;
        for (var pass = 0; pass < MaxPasses; pass++)
        {
            var run = await RunOnceAsync(cancellationToken);
            total += run.Sent;
            if (run.Claimed == 0)
                break;
        }
        return total;
    }
}
