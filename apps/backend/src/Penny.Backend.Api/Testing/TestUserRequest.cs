namespace Penny.Backend.Api.Testing;

// `DisplayName` (MAZ-171) is optional, as at registration. `Unverified` (MAZ-172) leaves the
// email unverified, as after a fresh sign-up; test users are verified otherwise, like
// every account that existed before email verification.
public sealed record TestUserRequest(
    string? Label,
    string? DisplayName = null,
    bool Unverified = false
);
