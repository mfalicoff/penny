namespace Penny.Backend.Api.Contracts;

// ExpiresAt is Unix milliseconds.
public sealed record OidcChallengeResponse(
    string Transaction,
    string AuthorizationUrl,
    long ExpiresAt
)
{
    public override string ToString() => "OIDC challenge (transaction redacted)";
}
