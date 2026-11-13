namespace Penny.Backend.Api.Contracts;

// Contract schema `Invite`: 10 upper-case hex characters, expiry in Unix milliseconds.
public sealed record InviteResponse(string Code, long ExpiresAt);
