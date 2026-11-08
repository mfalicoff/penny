using Penny.Backend.Application.Abstractions.Persistence;

namespace Penny.Backend.Application.Abstractions.Security;

// The configured OpenID Connect provider (legacy server/infrastructure/oidc.ts).
public interface IOidcProvider
{
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
}
