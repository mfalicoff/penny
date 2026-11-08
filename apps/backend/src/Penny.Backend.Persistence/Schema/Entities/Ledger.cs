namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class Ledger
{
    public required string UserId { get; set; }
    public required string Currency { get; set; }
    public long Revision { get; set; }
}
