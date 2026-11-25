using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Mail;
using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Application.Authentication;

// Email verification for password accounts (MAZ-172). Verification only records that the
// address is proven (users.email_verified_at); no feature waits for it. Provider accounts
// are verified when they are created, because the provider must say the email is verified.
//
// While the server sends email, registration and an email change queue a verification
// email; the mail runner issues the code when it sends (32 random bytes as hex, stored only
// as SHA-256, one per account, bound to the address), as for password resets. Opening the
// link redeems it once. Without email nothing is queued and clients show no unverified
// state; the `verify-email` operator command marks an account verified.
public sealed class EmailVerificationService(
    IAccountRepository accounts,
    IEmailVerificationRepository verifications,
    IMailOutbox outbox,
    MailPolicy mail,
    TimeProvider clock
)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(48);

    // Resending sooner than this queues nothing; the apps count it down.
    public static readonly TimeSpan ResendInterval = TimeSpan.FromSeconds(60);

    public const string InvalidToken = "This verification link is invalid or has expired.";
    public const string UnknownEmail = PasswordResetService.UnknownEmail;

    // After registration or an email change (and, with ResendInterval, a resend). Silent when
    // email is off, an email for the account is still unsent (it goes to the current address),
    // one was sent less than `minimumInterval` ago, or a daily limit is reached.
    public async Task QueueAsync(
        string userId,
        string email,
        string locale,
        TimeSpan minimumInterval,
        CancellationToken cancellationToken
    )
    {
        if (!mail.Enabled)
            return;
        await outbox.EnqueueAccountMailAsync(
            MailKinds.EmailVerification,
            userId,
            MailRecipients.Hash(email),
            locale,
            mail,
            Now(),
            minimumInterval,
            cancellationToken
        );
    }

    // A signed-in resend. The answer is the same whether or not an email is queued (a
    // verified account, one still waiting or sent less than a minute ago, the daily
    // limits). 404 while the server sends no email.
    public async Task ResendAsync(
        AuthenticatedSession session,
        string locale,
        CancellationToken cancellationToken
    )
    {
        if (!mail.Enabled)
            throw new BackendFailure(
                FailureKind.NotFound,
                ErrorCodes.MailDisabled,
                MailPolicy.Disabled
            );
        var user = await accounts.FindByIdAsync(session.UserId, cancellationToken)
            ?? throw new BackendFailure(
                FailureKind.Unauthorized,
                ErrorCodes.AuthSignInRequired,
                AuthService.SignInRequired
            );
        if (user.EmailVerifiedAt is not null)
            return;
        await QueueAsync(user.Id, user.Email, locale, ResendInterval, cancellationToken);
    }

    // Anonymous, so a link opened on another device works. Returns the verified address
    // (the holder of the code already has it). Works while email is off too, for links
    // sent before it was turned off.
    public async Task<string> VerifyAsync(string? token, CancellationToken cancellationToken)
    {
        if (!SessionTokens.IsWellFormed(token))
            throw new BackendFailure(
                FailureKind.Invalid,
                ErrorCodes.EmailVerificationInvalidToken,
                InvalidToken
            );
        return await verifications.TryRedeemAsync(
            SessionTokens.Hash(token),
            Now(),
            cancellationToken
        )
            ?? throw new BackendFailure(
                FailureKind.Invalid,
                ErrorCodes.EmailVerificationInvalidToken,
                InvalidToken
            );
    }

    // Mail runner: issues a code for the account's current address and renders its email.
    // Null when the account is gone or already verified.
    public async Task<OutgoingMail?> ComposeAsync(
        MailClaim claim,
        CancellationToken cancellationToken
    )
    {
        if (claim.UserId is not { } userId)
            return null;
        var user = await accounts.FindByIdAsync(userId, cancellationToken);
        if (user is null || user.EmailVerifiedAt is not null)
            return null;
        var token = SessionTokens.Create();
        var now = Now();
        await verifications.ReplaceAsync(
            user.Id,
            user.Email,
            SessionTokens.Hash(token),
            now + Lifetime,
            now,
            cancellationToken
        );
        var (subject, text) = MailTemplates.EmailVerification(
            claim.Locale,
            mail.AppUrl,
            token,
            Lifetime
        );
        return new OutgoingMail(claim.Id, user.Email, subject, text);
    }

    // Operator command: marks the account with this email verified. True when it changed,
    // false when it was already verified. The failures say whether an account exists, so
    // they never reach HTTP.
    public async Task<bool> MarkVerifiedAsync(string? email, CancellationToken cancellationToken)
    {
        var normalized = Credentials.NormalizeEmail(email)
            ?? throw new BackendFailure(
                FailureKind.Invalid,
                ErrorCodes.PasswordResetInvalidEmail,
                PasswordResetService.InvalidEmail
            );
        var user = await accounts.FindByEmailAsync(normalized, cancellationToken)
            ?? throw new BackendFailure(
                FailureKind.NotFound,
                ErrorCodes.EmailVerificationUnknownEmail,
                UnknownEmail
            );
        return await accounts.MarkEmailVerifiedAsync(user.Id, Now(), cancellationToken);
    }

    private DateTimeOffset Now() =>
        DateTimeOffset.FromUnixTimeMilliseconds(clock.GetUtcNow().ToUnixTimeMilliseconds());
}
