namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class LedgerCategory
{
    public required string UserId { get; set; }
    public required string Id { get; set; }
    public required string Name { get; set; }
    public required string Icon { get; set; }
    public required string Color { get; set; }
    public required string Kind { get; set; }
}
