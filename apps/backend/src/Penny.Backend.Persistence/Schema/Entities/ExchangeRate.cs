namespace Penny.Backend.Persistence.Schema.Entities;

// One reference rate the European Central Bank published (MAZ-151): how many units of
// `Currency` one euro was worth on `RateDate`, as a canonical decimal string. Shared by
// every user; nothing personal is stored here.
public sealed class ExchangeRate
{
    public DateOnly RateDate { get; set; }
    public required string Currency { get; set; }
    public required string PerEuro { get; set; }
}
