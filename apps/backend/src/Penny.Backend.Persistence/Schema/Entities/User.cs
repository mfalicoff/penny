namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class User
{
    public required string Id { get; set; }
    public required string Email { get; set; }
    public required string Password { get; set; }
}
