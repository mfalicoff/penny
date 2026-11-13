namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class LedgerAccount
{
    public required string UserId { get; set; }
    public required string Id { get; set; }
    public required string Name { get; set; }
    public required string Type { get; set; }
}
