namespace Penny.Backend.Application.Abstractions.Persistence;

// A user's profile row. `OidcIssuer` is the issuer of the account's sign-in provider, or null
// for a password account (an account has one sign-in method). `AvatarSourceHash` is SHA-256 of the provider picture URL the
// stored picture came from, so an unchanged URL is not downloaded again.
public sealed record StoredProfile(
    string UserId,
    string Email,
    string? DisplayName,
    bool NameFromProvider,
    bool AvatarFromProvider,
    bool NamePromptDismissed,
    string? OidcIssuer,
    string? AvatarVersion,
    byte[]? AvatarSourceHash
);
