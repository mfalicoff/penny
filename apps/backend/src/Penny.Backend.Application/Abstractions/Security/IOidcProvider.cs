using Penny.Backend.Application.Abstractions.Persistence;

namespace Penny.Backend.Application.Abstractions.Security;

// One configured OpenID Connect provider (MAZ-170: there may be several).
public interface IOidcProvider
{
    // The configured provider id (`Oidc__Providers__<id>`).
    string Id { get; }

    // Builds the Authorization Code + S256 PKCE request for the attempt.
    Task<string> CreateAuthorizationUrlAsync(
        StoredOidcAttempt attempt,
        CancellationToken cancellationToken
    );

    // Verifies the callback against the attempt (exact redirect URI, state, provider
    // errors, issuer), redeems the code server-side and validates the ID token
    // (signature, issuer, audience, expiry, nonce) and the verified email. Throws on
    // any failure; the exception never reaches clients.
    Task<VerifiedOidcIdentity> ExchangeAsync(
        string callbackUrl,
        StoredOidcAttempt attempt,
        CancellationToken cancellationToken
    );

    // Validates an ID token the app got from the platform's own sign-in (signature, issuer,
    // one of the native client ids as audience, expiry, the attempt's nonce) and the
    // verified email. `name` is what the platform gave the app (Apple: first sign-in only).
    Task<VerifiedOidcIdentity> VerifyNativeAsync(
        string idToken,
        StoredOidcAttempt attempt,
        string? name,
        CancellationToken cancellationToken
    );
}
