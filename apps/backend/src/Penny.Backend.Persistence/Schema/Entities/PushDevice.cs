namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class PushDevice
{
    public required string Token { get; set; }
    public required string UserId { get; set; }
    public required string SessionHash { get; set; }
    public required string Platform { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
