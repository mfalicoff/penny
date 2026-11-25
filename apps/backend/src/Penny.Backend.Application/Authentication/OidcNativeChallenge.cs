namespace Penny.Backend.Application.Authentication;

// A native sign-in attempt (MAZ-170): the app passes `Nonce` to the platform's sign-in and
// sends back the ID token with `Transaction`. ExpiresAt is Unix milliseconds.
public sealed record OidcNativeChallenge(string Transaction, string Nonce, long ExpiresAt)
{
    public override string ToString() => "OIDC native challenge (secrets redacted)";
}
