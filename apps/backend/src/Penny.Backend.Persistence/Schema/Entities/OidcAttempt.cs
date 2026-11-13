namespace Penny.Backend.Persistence.Schema.Entities;

// A pending OIDC sign-in. Keyed by SHA-256(transaction); the raw transaction stays
// with the initiating client. Rows are single-use and short-lived.
public sealed class OidcAttempt
{
    public required string TransactionHash { get; set; }
    public required string RedirectUri { get; set; }
    public required string State { get; set; }
    public required string Nonce { get; set; }
    public required string CodeVerifier { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}
