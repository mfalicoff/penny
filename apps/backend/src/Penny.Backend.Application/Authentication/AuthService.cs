using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Abstractions.Security;
using Penny.Backend.Application.Ledgers;
using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Application.Authentication;

// Password registration, sign-in and sign-out, and OIDC account sign-in. Messages,
// failure kinds and ordering are part of the client contract.
public sealed class AuthService(
    IAccountRepository accounts,
    ISessionRepository sessions,
    IPasswordHasher passwords,
    RegistrationPolicy policy,
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

    public async Task<IssuedSession> RegisterAsync(
        string? email,
        string? password,
        CancellationToken cancellationToken
    )
    {
        if (!policy.AllowRegistration)
            throw new BackendFailure(FailureKind.Forbidden, RegistrationDisabled);
        var credentials =
            Credentials.Normalize(email, password)
            ?? throw new BackendFailure(FailureKind.Invalid, InvalidRegistration);
        if (await accounts.FindByEmailAsync(credentials.Email, cancellationToken) is not null)
            throw new BackendFailure(FailureKind.Conflict, DuplicateEmail);
        var userId = SessionTokens.NewId();
        var hash = passwords.Hash(credentials.Password);
        // Another registration may commit while the password is hashed.
        if (
            !await accounts.TryCreateAsync(
                new StoredUser(userId, credentials.Email, hash),
                InitialLedger.Create(),
                cancellationToken
            )
        )
            throw new BackendFailure(FailureKind.Conflict, DuplicateEmail);
        return new(await IssueAsync(userId, cancellationToken), credentials.Email);
    }

    public async Task<IssuedSession> LoginAsync(
        string? email,
        string? password,
        CancellationToken cancellationToken
    )
    {
        var credentials =
            Credentials.Normalize(email, password)
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
            return new(await IssueAsync(existing.Id, cancellationToken), existing.Email);
        if (!allowRegistration)
            throw new BackendFailure(FailureKind.Forbidden, OidcRegistrationDisabled);
        if (await accounts.FindByEmailAsync(identity.Email, cancellationToken) is not null)
            throw new BackendFailure(FailureKind.Conflict, OidcEmailInUse);
        var userId = SessionTokens.NewId();
        // OIDC-only accounts have an empty password, which never verifies.
        var user = new StoredUser(userId, identity.Email, "");
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
        return new(await IssueAsync(userId, cancellationToken), identity.Email);
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

    public async Task<string> EmailAsync(string userId, CancellationToken cancellationToken) =>
        await accounts.FindEmailAsync(userId, cancellationToken)
        ?? throw new BackendFailure(FailureKind.Unauthorized, SignInRequired);

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
