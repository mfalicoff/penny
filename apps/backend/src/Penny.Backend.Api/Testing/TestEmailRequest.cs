namespace Penny.Backend.Api.Testing;

// `POST /api/test/email-verified` (MAZ-172): the seeded account to mark verified.
public sealed record TestEmailRequest(string? Email);
