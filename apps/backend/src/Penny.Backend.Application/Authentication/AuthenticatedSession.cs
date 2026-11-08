namespace Penny.Backend.Application.Authentication;

public sealed record AuthenticatedSession(string UserId, string TokenHash);
