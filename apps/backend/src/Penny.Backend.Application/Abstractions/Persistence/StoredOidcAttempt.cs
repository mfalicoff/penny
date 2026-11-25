namespace Penny.Backend.Application.Abstractions.Persistence;

// Server-side secrets of a pending OIDC sign-in. The raw transaction is never stored.
// `RedirectUri` is the app address the sign-in returns to, or null for a native sign-in,
// where the app gets an ID token from the platform and only the nonce is used.
public sealed record StoredOidcAttempt(
    string TransactionHash,
    string ProviderId,
    string? RedirectUri,
    string State,
    string Nonce,
    string CodeVerifier,
    DateTimeOffset ExpiresAt
)
{
    public override string ToString() => "OIDC attempt (secrets redacted)";
}
