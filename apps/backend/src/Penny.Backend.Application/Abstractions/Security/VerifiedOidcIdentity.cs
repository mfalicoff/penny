using Penny.Backend.Application.Profiles;

namespace Penny.Backend.Application.Abstractions.Security;

// A provider identity whose ID token, nonce and verified email have been checked, with the
// profile claims (`name` or `given_name` and `family_name`, and `picture`) it carried.
public sealed record VerifiedOidcIdentity(
    string Issuer,
    string Subject,
    string Email,
    ProviderProfile? Profile = null
)
{
    public override string ToString() => "Verified OIDC identity (details redacted)";
}
