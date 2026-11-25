using Penny.Backend.Application.Profiles;

namespace Penny.Backend.Application.Abstractions.Security;

// A provider identity whose ID token and nonce have been checked, with the profile claims
// (`name` or `given_name` and `family_name`, and `picture`) it carried. `Email` is the
// verified email, or null when the provider sent none (MAZ-170: Apple may leave it out
// after the first sign-in); a new account needs one.
public sealed record VerifiedOidcIdentity(
    string Issuer,
    string Subject,
    string? Email,
    ProviderProfile? Profile = null
)
{
    public override string ToString() => "Verified OIDC identity (details redacted)";
}
