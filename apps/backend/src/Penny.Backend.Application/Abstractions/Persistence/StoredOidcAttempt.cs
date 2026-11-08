namespace Penny.Backend.Application.Abstractions.Persistence;

// Server-side secrets of a pending OIDC sign-in. The raw transaction is never stored.
public sealed record StoredOidcAttempt(
    string TransactionHash,
    string RedirectUri,
    string State,
    string Nonce,
    string CodeVerifier,
    DateTimeOffset ExpiresAt
)
{
    public override string ToString() => "OIDC attempt (secrets redacted)";
}
