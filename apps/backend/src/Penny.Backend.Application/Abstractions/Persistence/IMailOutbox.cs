using Penny.Backend.Application.Mail;

namespace Penny.Backend.Application.Abstractions.Persistence;

// The outgoing mail outbox (MAZ-124), with the push outbox's lease discipline: every
// lease names a random token, so a runner that lost its lease changes nothing it no
// longer owns. Invitation emails are queued by the household unit of work
// (IHouseholdTransaction.EnqueueInviteMailAsync) in the invite's own transaction.
public interface IMailOutbox
{
    // One transaction holding the account's user row lock, so requests for one account
    // serialize: queues an email of `kind` (a password reset or an email verification) to
    // the account unless one of that kind for the account is still unsent or was created
    // less than `minimumInterval` ago, or the recipient or the account reached the daily
    // limit. True when queued.
    Task<bool> EnqueueAccountMailAsync(
        string kind,
        string userId,
        string recipientHash,
        string locale,
        MailPolicy policy,
        DateTimeOffset now,
        TimeSpan minimumInterval,
        CancellationToken cancellationToken
    );

    // Leases up to `limit` due, unfinished, unleased messages to `leaseToken`.
    Task<IReadOnlyList<MailClaim>> ClaimAsync(
        string leaseOwner,
        string leaseToken,
        DateTimeOffset now,
        DateTimeOffset leaseUntil,
        int limit,
        CancellationToken cancellationToken
    );

    // Records the outcome (counting the attempt), updates the invitation an invite email
    // carries (sent or failed) and releases the lease. Outcomes are facts about sends
    // that happened, so they are recorded even when the lease was lost meanwhile.
    Task RecordAsync(
        string messageId,
        string leaseToken,
        MailResult result,
        DateTimeOffset now,
        CancellationToken cancellationToken
    );

    // Deletes finished messages created before `createdBefore`; returns the count.
    Task<int> PurgeAsync(DateTimeOffset createdBefore, CancellationToken cancellationToken);
}
