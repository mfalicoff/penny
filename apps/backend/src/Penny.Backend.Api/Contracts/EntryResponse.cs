using System.Text.Json.Serialization;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Api.Contracts;

// Optional fields are omitted when absent, never written as null. Amounts are
// integer cents; dates are `YYYY-MM-DD` calendar dates.
public sealed record EntryResponse(
    string Id,
    string Title,
    string Kind,
    long Total,
    long Share,
    string CategoryId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? AccountId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? TripId,
    string Date,
    string Note,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        ReceiptResponse? Receipt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? RecurringId
)
{
    public static EntryResponse From(Entry entry) =>
        new(
            entry.Id,
            entry.Title,
            entry.Kind,
            entry.Total,
            entry.Share,
            entry.CategoryId,
            entry.AccountId,
            entry.TripId,
            LedgerDates.Write(entry.Date),
            entry.Note,
            entry.Receipt is null ? null : ReceiptResponse.From(entry.Receipt),
            entry.RecurringId
        );
}
