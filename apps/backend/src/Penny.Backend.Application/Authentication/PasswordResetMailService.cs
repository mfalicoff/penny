using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Mail;
using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Application.Authentication;

// Password resets by email (MAZ-124), next to the operator-issued codes of MAZ-123. A
// signed-out user asks for a reset; the request queues an email when the address has an
// account and answers the same either way. The mail runner issues the code when it
// sends (the same single-use, expiring code, stored only as SHA-256, replacing any
// earlier one), so the raw code exists only in the email. Redeeming it is the existing
// POST /api/auth/password-reset.
public sealed class PasswordResetMailService(
    IAccountRepository accounts,
    IPasswordResetRepository resets,
    IMailOutbox outbox,
    MailPolicy mail,
    PasswordResetPolicy policy,
    TimeProvider clock
)
{
    // Never says whether an account exists. Unknown addresses, an email still waiting to
    // be sent and the daily limits all end silently.
    public async Task RequestAsync(
        string? email,
        string locale,
        CancellationToken cancellationToken
    )
    {
        if (!mail.Enabled)
            throw new BackendFailure(FailureKind.NotFound, MailPolicy.Disabled);
        var normalized = Credentials.NormalizeEmail(email)
            ?? throw new BackendFailure(FailureKind.Invalid, PasswordResetService.InvalidEmail);
        var user = await accounts.FindByEmailAsync(normalized, cancellationToken);
        if (user is null)
            return;
        await outbox.EnqueueAccountMailAsync(
            MailKinds.PasswordReset,
            user.Id,
            MailRecipients.Hash(normalized),
            locale,
            mail,
            Now(),
            TimeSpan.Zero,
            cancellationToken
        );
    }

    // Mail runner: issues a code for the account and renders its email, to the account's
    // current address. Null when the account is gone.
    public async Task<OutgoingMail?> ComposeAsync(
        MailClaim claim,
        CancellationToken cancellationToken
    )
    {
        if (claim.UserId is not { } userId)
            return null;
        var user = await accounts.FindByIdAsync(userId, cancellationToken);
        if (user is null)
            return null;
        var token = SessionTokens.Create();
        var now = Now();
        await resets.ReplaceAsync(
            user.Id,
            SessionTokens.Hash(token),
            now + policy.Lifetime,
            now,
            cancellationToken
        );
        var (subject, text) = MailTemplates.PasswordReset(
            claim.Locale,
            mail.AppUrl,
            token,
            policy.Lifetime
        );
        return new OutgoingMail(claim.Id, user.Email, subject, text);
    }

    private DateTimeOffset Now() =>
        DateTimeOffset.FromUnixTimeMilliseconds(clock.GetUtcNow().ToUnixTimeMilliseconds());
}
