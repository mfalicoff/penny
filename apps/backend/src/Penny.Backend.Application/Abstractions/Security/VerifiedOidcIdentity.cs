namespace Penny.Backend.Application.Abstractions.Security;

// A provider identity whose ID token, nonce and verified email have been checked.
public sealed record VerifiedOidcIdentity(string Issuer, string Subject, string Email)
{
    public override string ToString() => "Verified OIDC identity (details redacted)";
}
