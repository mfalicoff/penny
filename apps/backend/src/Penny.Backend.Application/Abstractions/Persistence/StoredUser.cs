namespace Penny.Backend.Application.Abstractions.Persistence;

public sealed record StoredUser(
    string Id,
    string Email,
    string Password,
    string? DisplayName = null
)
{
    public override string ToString() => "Stored user (credentials redacted)";
}
