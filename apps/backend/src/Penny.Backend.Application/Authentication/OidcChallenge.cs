namespace Penny.Backend.Application.Authentication;

// ExpiresAt is Unix milliseconds, as in the legacy API.
public sealed record OidcChallenge(string Transaction, string AuthorizationUrl, long ExpiresAt)
{
    public override string ToString() => "OIDC challenge (transaction redacted)";
}
