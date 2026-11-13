namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class Session
{
    public required string TokenHash { get; set; }
    public required string UserId { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}
