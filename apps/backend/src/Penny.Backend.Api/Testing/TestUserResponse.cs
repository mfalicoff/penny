namespace Penny.Backend.Api.Testing;

// A fresh account for one test: generated email and password and a live session.
public sealed record TestUserResponse(string UserId, string Email, string Password, string Token);
