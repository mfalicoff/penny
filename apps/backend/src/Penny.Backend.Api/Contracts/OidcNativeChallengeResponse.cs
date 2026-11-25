namespace Penny.Backend.Api.Contracts;

// MAZ-170. The app passes `nonce` to the platform's sign-in unchanged. ExpiresAt is Unix
// milliseconds.
public sealed record OidcNativeChallengeResponse(string Transaction, string Nonce, long ExpiresAt)
{
    public override string ToString() => "OIDC native challenge (secrets redacted)";
}
