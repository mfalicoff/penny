namespace Penny.Backend.Application.Households;

// The only time the plain code exists; storage keeps its SHA-256. `ExpiresAt` is Unix
// milliseconds.
public sealed record IssuedInvite(string Code, long ExpiresAt);
