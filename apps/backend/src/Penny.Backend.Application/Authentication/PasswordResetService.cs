using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Abstractions.Security;
using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Application.Authentication;

// Operator-issued password resets (MAZ-123). Penny is self-hosted without email
// delivery, so an operator issues a code for an email and delivers it out of band.
// Codes use the session token format (32 random bytes, lowercase hex), are stored
// only as SHA-256, expire and can be used once. Redeeming one sets a new Identity
// hash and revokes every session; it never signs the caller in.
public sealed class PasswordResetService(
    IAccountRepository accounts,
    IPasswordResetRepository resets,
    IPasswordHasher passwords,
    PasswordResetPolicy policy,
    TimeProvider clock
)
{
    public const string InvalidToken = "This reset code is invalid or has expired.";
    public const string InvalidPassword = "Enter a password of 10–256 characters.";
    public const string InvalidEmail = "Enter a valid email address.";
    public const string UnknownEmail =
        "No account uses this email. Emails match exactly after trimming and lowercasing.";

    // Operator use only: these failures say whether an account exists, so they must
    // never reach HTTP. Works for password accounts and for
    // OIDC-only accounts, where the reset adds a password.
    public async Task<IssuedPasswordReset> IssueAsync(
        string? email,
        CancellationToken cancellationToken
    )
    {
        var normalized =
            Credentials.NormalizeEmail(email)
            ?? throw new BackendFailure(FailureKind.Invalid, InvalidEmail);
        var user =
            await accounts.FindByEmailAsync(normalized, cancellationToken)
            ?? throw new BackendFailure(FailureKind.NotFound, UnknownEmail);
        var token = SessionTokens.Create();
        var now = Now();
        var expiresAt = now + policy.Lifetime;
        await resets.ReplaceAsync(
            user.Id,
            SessionTokens.Hash(token),
            expiresAt,
            now,
            cancellationToken
        );
        return new(token, expiresAt, user.Password.Length > 0);
    }

    // The request names no email, so its answers cannot reveal whether one exists.
    // The password is checked before the code is touched, so a rejected password
    // leaves the code usable.
    public async Task CompleteAsync(
        string? token,
        string? password,
        CancellationToken cancellationToken
    )
    {
        if (!SessionTokens.IsWellFormed(token))
            throw new BackendFailure(FailureKind.Invalid, InvalidToken);
        if (!Credentials.IsValidPassword(password))
            throw new BackendFailure(FailureKind.Invalid, InvalidPassword);
        // Hashed outside the transaction; unknown codes cost the same work.
        var hash = passwords.Hash(password);
        if (!await resets.TryRedeemAsync(SessionTokens.Hash(token), hash, Now(), cancellationToken))
            throw new BackendFailure(FailureKind.Invalid, InvalidToken);
    }

    // Whole milliseconds, like session expiry.
    private DateTimeOffset Now() =>
        DateTimeOffset.FromUnixTimeMilliseconds(clock.GetUtcNow().ToUnixTimeMilliseconds());
}
