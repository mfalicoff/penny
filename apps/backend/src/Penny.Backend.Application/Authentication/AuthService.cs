using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Abstractions.Security;
using Penny.Backend.Application.Ledgers;
using Penny.Backend.Application.Profiles;
using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Application.Authentication;

// Password registration, sign-in and sign-out, and OIDC account sign-in. Messages,
// failure kinds and ordering are part of the client contract.
public sealed class AuthService(
    IAccountRepository accounts,
    ISessionRepository sessions,
    IPasswordHasher passwords,
    RegistrationPolicy policy,
    ProfileService profiles,
    EmailVerificationService verification,
    TimeProvider clock
)
{
    public const string DuplicateEmail =
        "An account with this email already exists. Please sign in.";
    public const string InvalidCredentials = "Email or password is incorrect.";
    public const string SignInRequired = "Please sign in to continue.";
    public const string RegistrationDisabled = "Account registration is disabled on this server.";
    public const string InvalidRegistration =
        "Enter a valid email and a password of 10–256 characters.";
    public const string OidcRegistrationDisabled =
        "New single sign-on accounts are disabled on this server.";
    public const string OidcEmailInUse =
        "An account already uses this email. Sign in with its existing method; automatic account linking is disabled.";
    public const string OidcAccountExists =
        "This account already exists. Please try signing in again.";
    public const string WrongCurrentPassword = "Your current password is incorrect.";
    public const string InvalidNewPassword = "Use a new password of 10–256 characters.";
    public const string EmailInUse = "Another account already uses this email.";
    public const string EmailManaged =
        "Your sign-in provider manages your email. Change it with your provider.";
    public const string NoPassword =
        "Your account signs in with your sign-in provider, so it has no password to change.";

    public async Task<IssuedSession> RegisterAsync(
        string? email,
        string? password,
        string? displayName,
        string locale,
        CancellationToken cancellationToken
    )
    {
        if (!policy.AllowRegistration)
            throw new BackendFailure(FailureKind.Forbidden, RegistrationDisabled);
        var credentials = Credentials.Normalize(email, password)
            ?? throw new BackendFailure(FailureKind.Invalid, InvalidRegistration);
        // The name is optional (older apps don't send it); a blank one counts as none.
        string? name = null;
        if (!DisplayName.IsBlank(displayName))
            name = DisplayName.Normalize(displayName)
                ?? throw new BackendFailure(FailureKind.Invalid, ProfileService.InvalidName);
        if (await accounts.FindByEmailAsync(credentials.Email, cancellationToken) is not null)
            throw new BackendFailure(FailureKind.Conflict, DuplicateEmail);
        var userId = SessionTokens.NewId();
        var hash = passwords.Hash(credentials.Password);
        // Another registration may commit while the password is hashed.
        if (
            !await accounts.TryCreateAsync(
                new StoredUser(userId, credentials.Email, hash, name),
                InitialLedger.Create(),
                cancellationToken
            )
        )
            throw new BackendFailure(FailureKind.Conflict, DuplicateEmail);
        // MAZ-172: a new password account starts unverified; the email waits in the outbox.
        await verification.QueueAsync(
            userId,
            credentials.Email,
            locale,
            TimeSpan.Zero,
            cancellationToken
        );
        return new(await IssueAsync(userId, cancellationToken), credentials.Email);
    }

    public async Task<IssuedSession> LoginAsync(
        string? email,
        string? password,
        CancellationToken cancellationToken
    )
    {
        var credentials = Credentials.Normalize(email, password)
            ?? throw new BackendFailure(FailureKind.Unauthorized, InvalidCredentials);
        var user = await accounts.FindByEmailAsync(credentials.Email, cancellationToken);
        // Always verify, so unknown emails cost the same as wrong passwords.
        var check = passwords.Verify(user?.Password, credentials.Password);
        if (user is null || check == PasswordCheck.Failed)
            throw new BackendFailure(FailureKind.Unauthorized, InvalidCredentials);
        if (check == PasswordCheck.SuccessRehashNeeded)
            await accounts.UpdatePasswordAsync(
                user.Id,
                user.Password,
                passwords.Hash(credentials.Password),
                cancellationToken
            );
        return new(await IssueAsync(user.Id, cancellationToken), user.Email);
    }

    // OIDC accounts are found by the stable (issuer, subject) pair, so
    // a changed provider email still signs in to the same account. An existing account
    // with the same email is never linked automatically.
    public async Task<IssuedSession> LoginOidcAsync(
        VerifiedOidcIdentity identity,
        bool allowRegistration,
        CancellationToken cancellationToken
    )
    {
        var existing = await accounts.FindByIdentityAsync(
            identity.Issuer,
            identity.Subject,
            cancellationToken
        );
        if (existing is not null)
        {
            await profiles.ApplyProviderAsync(existing.Id, identity.Profile, cancellationToken);
            return new(await IssueAsync(existing.Id, cancellationToken), existing.Email);
        }
        if (!allowRegistration)
            throw new BackendFailure(FailureKind.Forbidden, OidcRegistrationDisabled);
        // A new account needs the verified email; an existing one is found without it.
        if (identity.Email is not { } email)
            throw new BackendFailure(FailureKind.Unauthorized, OidcService.NotVerified);
        if (await accounts.FindByEmailAsync(email, cancellationToken) is not null)
            throw new BackendFailure(FailureKind.Conflict, OidcEmailInUse);
        var userId = SessionTokens.NewId();
        // OIDC-only accounts have an empty password, which never verifies.
        // The provider said the email is verified (MAZ-172).
        var user = new StoredUser(userId, email, "", EmailVerifiedAt: Now());
        if (
            !await accounts.TryCreateOidcAsync(
                user,
                identity.Issuer,
                identity.Subject,
                InitialLedger.Create(),
                cancellationToken
            )
        )
            throw new BackendFailure(FailureKind.Conflict, OidcAccountExists);
        await profiles.ApplyProviderAsync(userId, identity.Profile, cancellationToken);
        return new(await IssueAsync(userId, cancellationToken), email);
    }

    // A signed-in password change (MAZ-171): the current password must verify, the new one
    // follows the sign-up rule. Every other session of the account ends; this one stays.
    // Accounts that sign in with a provider have no password (an empty hash) and are refused.
    // A wrong current password is a 400, not a 401, so the session survives the mistake.
    public async Task ChangePasswordAsync(
        AuthenticatedSession session,
        string? currentPassword,
        string? newPassword,
        CancellationToken cancellationToken
    )
    {
        var user = await accounts.FindByIdAsync(session.UserId, cancellationToken)
            ?? throw new BackendFailure(FailureKind.Unauthorized, SignInRequired);
        if (user.Password.Length == 0)
            throw new BackendFailure(FailureKind.Forbidden, NoPassword);
        if (!Credentials.IsValidPassword(newPassword))
            throw new BackendFailure(FailureKind.Invalid, InvalidNewPassword);
        // Always verify, so a missing current password costs the same as a wrong one.
        if (passwords.Verify(user.Password, currentPassword ?? "") == PasswordCheck.Failed)
            throw new BackendFailure(FailureKind.Invalid, WrongCurrentPassword);
        if (
            !await accounts.TryChangePasswordAsync(
                user.Id,
                user.Password,
                passwords.Hash(newPassword),
                session.TokenHash,
                Now(),
                cancellationToken
            )
        )
            throw new BackendFailure(FailureKind.Invalid, WrongCurrentPassword);
    }

    // A signed-in email change for a password account (MAZ-172): the current password must
    // verify and the address follows the sign-up rule. The account becomes unverified, its
    // pending verification code stops working, and a new verification email is queued
    // while the server sends email. Sessions stay. The same address changes nothing. An
    // address another account uses is a 409, as at registration.
    public async Task<ProfileView> ChangeEmailAsync(
        AuthenticatedSession session,
        string? email,
        string? password,
        string locale,
        CancellationToken cancellationToken
    )
    {
        var user = await accounts.FindByIdAsync(session.UserId, cancellationToken)
            ?? throw new BackendFailure(FailureKind.Unauthorized, SignInRequired);
        if (user.Password.Length == 0)
            throw new BackendFailure(FailureKind.Forbidden, EmailManaged);
        var normalized = Credentials.NormalizeEmail(email)
            ?? throw new BackendFailure(FailureKind.Invalid, PasswordResetService.InvalidEmail);
        // Always verify, so a missing password costs the same as a wrong one.
        if (passwords.Verify(user.Password, password ?? "") == PasswordCheck.Failed)
            throw new BackendFailure(FailureKind.Invalid, WrongCurrentPassword);
        if (!string.Equals(normalized, user.Email, StringComparison.Ordinal))
        {
            if (await accounts.FindByEmailAsync(normalized, cancellationToken) is not null)
                throw new BackendFailure(FailureKind.Conflict, EmailInUse);
            switch (
                await accounts.TryChangeEmailAsync(
                    user.Id,
                    user.Password,
                    normalized,
                    cancellationToken
                )
            )
            {
                case EmailChangeResult.Duplicate:
                    throw new BackendFailure(FailureKind.Conflict, EmailInUse);
                case EmailChangeResult.Stale:
                    throw new BackendFailure(FailureKind.Invalid, WrongCurrentPassword);
            }
            await verification.QueueAsync(
                user.Id,
                normalized,
                locale,
                TimeSpan.Zero,
                cancellationToken
            );
        }
        return await profiles.GetAsync(user.Id, cancellationToken);
    }

    // Returns null for a missing, malformed, unknown, expired or revoked token.
    public async Task<AuthenticatedSession?> AuthenticateAsync(
        string? token,
        CancellationToken cancellationToken
    )
    {
        if (string.IsNullOrEmpty(token))
            return null;
        var tokenHash = SessionTokens.Hash(token);
        var userId = await sessions.FindUserAsync(tokenHash, Now(), cancellationToken);
        return userId is null ? null : new(userId, tokenHash);
    }

    public Task LogoutAsync(string tokenHash, CancellationToken cancellationToken) =>
        sessions.RemoveAsync(tokenHash, cancellationToken);

    private async Task<string> IssueAsync(string userId, CancellationToken cancellationToken)
    {
        var token = SessionTokens.Create();
        var issuedAt = Now();
        await sessions.CreateAsync(
            SessionTokens.Hash(token),
            userId,
            issuedAt + SessionTokens.Lifetime,
            issuedAt,
            cancellationToken
        );
        return token;
    }

    // Expiries are integer milliseconds; truncating keeps the boundary exact.
    private DateTimeOffset Now() =>
        DateTimeOffset.FromUnixTimeMilliseconds(clock.GetUtcNow().ToUnixTimeMilliseconds());
}
