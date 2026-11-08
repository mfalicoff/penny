using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Ledgers;
using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Application.Authentication;

// Port of the legacy password auth service (server/application/auth.ts). Messages,
// failure kinds and ordering are part of the client contract.
public sealed class AuthService(
    IAccountRepository accounts,
    ISessionRepository sessions,
    LegacyPasswordHasher passwords,
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

    // Used when no user matches, so unknown emails cost one full derivation too.
    private static readonly string MissingSalt = new('0', 32);
    private static readonly string MissingHash = new('0', 128);

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
        var salt = SessionTokens.NewId();
        var hash = await passwords.HashAsync(credentials.Password, salt, cancellationToken);
        // Another registration may commit while the password is hashed.
        if (
            !await accounts.TryCreateAsync(
                new StoredUser(userId, credentials.Email, hash, salt),
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
        var valid = await passwords.VerifyAsync(
            credentials.Password,
            user?.Salt ?? MissingSalt,
            user?.Password ?? MissingHash,
            cancellationToken
        );
        if (user is null || !valid)
            throw new BackendFailure(FailureKind.Unauthorized, InvalidCredentials);
        return new(await IssueAsync(user.Id, cancellationToken), user.Email);
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

    // Legacy expiry is integer milliseconds; truncating keeps the boundary exact.
    private DateTimeOffset Now() =>
        DateTimeOffset.FromUnixTimeMilliseconds(clock.GetUtcNow().ToUnixTimeMilliseconds());
}
