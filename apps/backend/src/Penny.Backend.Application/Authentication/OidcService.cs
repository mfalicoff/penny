using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Abstractions.Security;
using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Application.Authentication;

// OIDC sign-in attempts. Short-lived secrets
// (state, nonce, PKCE verifier) stay on the server, keyed by SHA-256 of a transaction
// that only the initiating app holds; they never appear in redirect URLs.
public sealed class OidcService(
    OidcSettings settings,
    IOidcProvider provider,
    IOidcAttemptRepository attempts,
    AuthService auth,
    TimeProvider clock
)
{
    public const string NotConfigured = "Single sign-on is not configured.";
    public const string RedirectNotConfigured =
        "This sign-in redirect is not configured on the server.";
    public const string TooManyAttempts = "Too many sign-in attempts. Try again later.";
    public const string ProviderUnavailable =
        "The sign-in provider is unavailable. Please try again.";
    public const string InvalidResponse = "Invalid sign-in response.";
    public const string Expired = "Sign-in expired. Please try again.";
    public const string NotVerified =
        "Sign-in could not be verified. Please try again and allow access to your verified email.";

    public const int MaxPendingAttempts = 1000;
    public const int MaxCallbackLength = 8192;
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);

    public string Label => settings.Label;

    public async Task<OidcChallenge> StartAsync(
        string? redirectUri,
        CancellationToken cancellationToken
    )
    {
        if (
            redirectUri is null
            || !settings.RedirectUris.Contains(redirectUri, StringComparer.Ordinal)
        )
            throw new BackendFailure(FailureKind.Invalid, RedirectNotConfigured);
        var transaction = SessionTokens.Create();
        var now = Now();
        var attempt = new StoredOidcAttempt(
            SessionTokens.Hash(transaction),
            redirectUri,
            SessionTokens.Create(),
            SessionTokens.Create(),
            SessionTokens.Create(),
            now + Lifetime
        );
        if (!await attempts.TryCreateAsync(attempt, now, MaxPendingAttempts, cancellationToken))
            throw new BackendFailure(FailureKind.Forbidden, TooManyAttempts);
        string authorizationUrl;
        try
        {
            authorizationUrl = await provider.CreateAuthorizationUrlAsync(
                attempt,
                cancellationToken
            );
        }
        catch (Exception error)
        {
            await attempts.RemoveAsync(attempt.TransactionHash, CancellationToken.None);
            if (error is OperationCanceledException && cancellationToken.IsCancellationRequested)
                throw;
            throw new BackendFailure(FailureKind.Invalid, ProviderUnavailable);
        }
        return new(transaction, authorizationUrl, attempt.ExpiresAt.ToUnixTimeMilliseconds());
    }

    public async Task<IssuedSession> CompleteAsync(
        string? transaction,
        string? callbackUrl,
        CancellationToken cancellationToken
    )
    {
        if (
            !SessionTokens.IsWellFormed(transaction)
            || callbackUrl is null
            || callbackUrl.Length > MaxCallbackLength
        )
            throw new BackendFailure(FailureKind.Invalid, InvalidResponse);
        // Consumed before the provider exchange, so replays and concurrent redemptions
        // of the same transaction fail even if this exchange fails.
        var attempt = await attempts.ConsumeAsync(
            SessionTokens.Hash(transaction!),
            cancellationToken
        );
        if (attempt is null || attempt.ExpiresAt <= Now())
            throw new BackendFailure(FailureKind.Unauthorized, Expired);
        VerifiedOidcIdentity identity;
        try
        {
            identity = await provider.ExchangeAsync(callbackUrl, attempt, cancellationToken);
        }
        catch (Exception error)
            when (error is not OperationCanceledException
                || !cancellationToken.IsCancellationRequested
            )
        {
            throw new BackendFailure(FailureKind.Unauthorized, NotVerified);
        }
        if (
            !string.Equals(identity.Issuer, settings.Issuer, StringComparison.Ordinal)
            || identity.Subject.Length == 0
        )
            throw new BackendFailure(FailureKind.Unauthorized, NotVerified);
        return await auth.LoginOidcAsync(identity, settings.AllowRegistration, cancellationToken);
    }

    // Expiries are integer milliseconds; truncating keeps the boundary exact.
    private DateTimeOffset Now() =>
        DateTimeOffset.FromUnixTimeMilliseconds(clock.GetUtcNow().ToUnixTimeMilliseconds());
}
