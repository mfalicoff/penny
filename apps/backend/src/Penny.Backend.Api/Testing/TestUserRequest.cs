namespace Penny.Backend.Api.Testing;

// `DisplayName` (MAZ-171) is optional, as at registration.
public sealed record TestUserRequest(string? Label, string? DisplayName = null);
