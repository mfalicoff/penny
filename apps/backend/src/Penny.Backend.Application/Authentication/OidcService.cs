using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Abstractions.Security;
using Penny.Backend.Application.Profiles;
using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Application.Authentication;

// OIDC sign-in attempts, for each configured provider (MAZ-170). Short-lived secrets
// (state, nonce, PKCE verifier) stay on the server, keyed by SHA-256 of a transaction
// that only the initiating app holds; they never appear in redirect URLs.
public sealed class OidcService(
    OidcSettings settings,
    IEnumerable<IOidcProvider> providers,
    IOidcAttemptRepository attempts,
    AuthService auth,
    TimeProvider clock
)
{
    public const string NotConfigured = "Single sign-on is not configured.";
    public const string ProviderNotConfigured =
        "This sign-in provider is not configured on the server.";
    public const string NativeNotConfigured =
        "This sign-in provider can't be used from the app's own sign-in.";
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
    public const int MaxIdTokenLength = 8192;
    public const int MaxNameLength = 200;
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);

    // The parameters the callback relay hands on to the app (RFC 6749 section 4.1.2, RFC
    // 9207 `iss`, and Apple's first-sign-in `user`). Anything else is dropped.
    private static readonly string[] RelayedParameters = ["code", "state", "iss", "error", "user"];

    private readonly Dictionary<string, IOidcProvider> clients = providers.ToDictionary(
        provider => provider.Id,
        StringComparer.Ordinal
    );

    public IReadOnlyList<OidcProviderSettings> Providers => settings.Providers;

    // `providerId` null means the first provider: clients from before MAZ-170 send none.
    public async Task<OidcChallenge> StartAsync(
        string? providerId,
        string? redirectUri,
        CancellationToken cancellationToken
    )
    {
        var (provider, client) = Resolve(providerId);
        if (
            redirectUri is null
            || !provider.RedirectUris.Contains(redirectUri, StringComparer.Ordinal)
        )
            throw new BackendFailure(
                FailureKind.Invalid,
                ErrorCodes.OidcRedirectNotConfigured,
                RedirectNotConfigured
            );
        var attempt = await CreateAttemptAsync(provider.Id, redirectUri, cancellationToken);
        string authorizationUrl;
        try
        {
            authorizationUrl = await client.CreateAuthorizationUrlAsync(
                attempt.Stored,
                cancellationToken
            );
        }
        catch (Exception error)
        {
            await attempts.RemoveAsync(attempt.Stored.TransactionHash, CancellationToken.None);
            if (error is OperationCanceledException && cancellationToken.IsCancellationRequested)
                throw;
            throw new BackendFailure(
                FailureKind.Invalid,
                ErrorCodes.OidcProviderUnavailable,
                ProviderUnavailable
            );
        }
        return new(
            attempt.Transaction,
            authorizationUrl,
            attempt.Stored.ExpiresAt.ToUnixTimeMilliseconds()
        );
    }

    // A relayed provider's response arrives at this API (Apple posts it). The pending
    // attempt is found by `state` and the response is handed on, unchanged, to the app
    // redirect that attempt was started for; it is checked when the app completes.
    public async Task<string> RelayAsync(
        string providerId,
        IReadOnlyDictionary<string, string> parameters,
        CancellationToken cancellationToken
    )
    {
        if (settings.Find(providerId) is not { Relayed: true })
            throw new BackendFailure(
                FailureKind.NotFound,
                ErrorCodes.OidcProviderNotConfigured,
                ProviderNotConfigured
            );
        if (
            !parameters.TryGetValue("state", out var state)
            || state.Length is 0 or > 256
            || await attempts.FindByStateAsync(state, cancellationToken)
                is not { RedirectUri: { } redirectUri } attempt
            || attempt.ProviderId != providerId
            || attempt.ExpiresAt <= Now()
        )
            throw new BackendFailure(FailureKind.Unauthorized, ErrorCodes.OidcExpired, Expired);
        var query = string.Join(
            '&',
            RelayedParameters
                .Where(parameters.ContainsKey)
                .Select(name => $"{name}={Uri.EscapeDataString(parameters[name])}")
        );
        var target = $"{redirectUri}?{query}";
        if (target.Length > MaxCallbackLength)
            throw new BackendFailure(
                FailureKind.Invalid,
                ErrorCodes.OidcInvalidResponse,
                InvalidResponse
            );
        return target;
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
            throw new BackendFailure(
                FailureKind.Invalid,
                ErrorCodes.OidcInvalidResponse,
                InvalidResponse
            );
        var (attempt, provider, client) = await ConsumeAsync(transaction!, cancellationToken);
        if (attempt.RedirectUri is null)
            throw new BackendFailure(FailureKind.Unauthorized, ErrorCodes.OidcExpired, Expired);
        var identity = await VerifyAsync(
            () => client.ExchangeAsync(callbackUrl, attempt, cancellationToken),
            provider,
            cancellationToken
        );
        return await auth.LoginOidcAsync(identity, provider.AllowRegistration, cancellationToken);
    }

    public async Task<OidcNativeChallenge> StartNativeAsync(
        string? providerId,
        CancellationToken cancellationToken
    )
    {
        var (provider, _) = Resolve(providerId ?? "");
        if (!provider.Native)
            throw new BackendFailure(
                FailureKind.Invalid,
                ErrorCodes.OidcNativeNotConfigured,
                NativeNotConfigured
            );
        var attempt = await CreateAttemptAsync(provider.Id, null, cancellationToken);
        return new(
            attempt.Transaction,
            attempt.Stored.Nonce,
            attempt.Stored.ExpiresAt.ToUnixTimeMilliseconds()
        );
    }

    // `givenName` and `familyName` are what the platform's sign-in gave the app; Apple
    // gives them only the first time someone signs in to the app.
    public async Task<IssuedSession> CompleteNativeAsync(
        string? transaction,
        string? idToken,
        string? givenName,
        string? familyName,
        CancellationToken cancellationToken
    )
    {
        if (
            !SessionTokens.IsWellFormed(transaction)
            || idToken is null
            || idToken.Length is 0 or > MaxIdTokenLength
            || givenName?.Length > MaxNameLength
            || familyName?.Length > MaxNameLength
        )
            throw new BackendFailure(
                FailureKind.Invalid,
                ErrorCodes.OidcInvalidResponse,
                InvalidResponse
            );
        var (attempt, provider, client) = await ConsumeAsync(transaction!, cancellationToken);
        if (attempt.RedirectUri is not null || !provider.Native)
            throw new BackendFailure(FailureKind.Unauthorized, ErrorCodes.OidcExpired, Expired);
        var name = DisplayName.FromProvider(null, givenName, familyName);
        var identity = await VerifyAsync(
            () => client.VerifyNativeAsync(idToken, attempt, name, cancellationToken),
            provider,
            cancellationToken
        );
        return await auth.LoginOidcAsync(identity, provider.AllowRegistration, cancellationToken);
    }

    private (OidcProviderSettings Provider, IOidcProvider Client) Resolve(string? providerId)
    {
        var provider = providerId is null
            ? settings.Providers[0]
            : settings.Find(providerId)
                ?? throw new BackendFailure(
                    FailureKind.Invalid,
                    ErrorCodes.OidcProviderNotConfigured,
                    ProviderNotConfigured
                );
        return (provider, clients[provider.Id]);
    }

    private async Task<(string Transaction, StoredOidcAttempt Stored)> CreateAttemptAsync(
        string providerId,
        string? redirectUri,
        CancellationToken cancellationToken
    )
    {
        var transaction = SessionTokens.Create();
        var now = Now();
        var attempt = new StoredOidcAttempt(
            SessionTokens.Hash(transaction),
            providerId,
            redirectUri,
            SessionTokens.Create(),
            SessionTokens.Create(),
            SessionTokens.Create(),
            now + Lifetime
        );
        if (!await attempts.TryCreateAsync(attempt, now, MaxPendingAttempts, cancellationToken))
            throw new BackendFailure(
                FailureKind.Forbidden,
                ErrorCodes.OidcTooManyAttempts,
                TooManyAttempts
            );
        return (transaction, attempt);
    }

    // Consumed before the provider exchange, so replays and concurrent redemptions of the
    // same transaction fail even if this exchange fails. An attempt whose provider is no
    // longer configured has expired.
    private async Task<(
        StoredOidcAttempt Attempt,
        OidcProviderSettings Provider,
        IOidcProvider Client
    )> ConsumeAsync(string transaction, CancellationToken cancellationToken)
    {
        var attempt = await attempts.ConsumeAsync(
            SessionTokens.Hash(transaction),
            cancellationToken
        );
        if (
            attempt is null
            || attempt.ExpiresAt <= Now()
            || settings.Find(attempt.ProviderId) is not { } provider
        )
            throw new BackendFailure(FailureKind.Unauthorized, ErrorCodes.OidcExpired, Expired);
        return (attempt, provider, clients[provider.Id]);
    }

    private static async Task<VerifiedOidcIdentity> VerifyAsync(
        Func<Task<VerifiedOidcIdentity>> verify,
        OidcProviderSettings provider,
        CancellationToken cancellationToken
    )
    {
        VerifiedOidcIdentity identity;
        try
        {
            identity = await verify();
        }
        catch (Exception error)
            when (error is not OperationCanceledException
                || !cancellationToken.IsCancellationRequested
            )
        {
            throw new BackendFailure(
                FailureKind.Unauthorized,
                ErrorCodes.OidcNotVerified,
                NotVerified
            );
        }
        if (
            !string.Equals(identity.Issuer, provider.Issuer, StringComparison.Ordinal)
            || identity.Subject.Length == 0
        )
            throw new BackendFailure(
                FailureKind.Unauthorized,
                ErrorCodes.OidcNotVerified,
                NotVerified
            );
        return identity;
    }

    // Expiries are integer milliseconds; truncating keeps the boundary exact.
    private DateTimeOffset Now() =>
        DateTimeOffset.FromUnixTimeMilliseconds(clock.GetUtcNow().ToUnixTimeMilliseconds());
}
