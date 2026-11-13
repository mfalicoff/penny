namespace Penny.Backend.Application.Authentication;

// The raw code is returned once, to the operator; only its hash is stored.
public sealed record IssuedPasswordReset(string Token, DateTimeOffset ExpiresAt, bool HadPassword)
{
    public override string ToString() => "Issued password reset (code redacted)";
}
