namespace Penny.Backend.Application.Abstractions.Persistence;

// `EmailVerifiedAt` (MAZ-172): when the current email was proven, null while unverified.
public sealed record StoredUser(
    string Id,
    string Email,
    string Password,
    string? DisplayName = null,
    DateTimeOffset? EmailVerifiedAt = null
)
{
    public override string ToString() => "Stored user (credentials redacted)";
}
