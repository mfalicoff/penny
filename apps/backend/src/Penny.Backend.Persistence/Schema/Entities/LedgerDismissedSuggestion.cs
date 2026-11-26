namespace Penny.Backend.Persistence.Schema.Entities;

// One recurring suggestion the person dismissed (contract 2.3.0). `Value` is opaque to
// the server; `Position` keeps the order the client sent (newest last).
public sealed class LedgerDismissedSuggestion
{
    public required string UserId { get; set; }
    public required string Value { get; set; }
    public int Position { get; set; }
}
