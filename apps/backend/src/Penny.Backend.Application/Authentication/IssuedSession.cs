namespace Penny.Backend.Application.Authentication;

public sealed record IssuedSession(string Token, string Email)
{
    public override string ToString() => $"Session for {Email} (token redacted)";
}
