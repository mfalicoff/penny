using System.Text.Json.Serialization;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Api.Contracts;

public sealed record RecurringResponse(
    string Id,
    string Title,
    string Kind,
    long Total,
    long Share,
    string CategoryId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? AccountId,
    string Date,
    string Note,
    string Frequency,
    string NextDate,
    int AnchorDay,
    bool Active
)
{
    public static RecurringResponse From(RecurringRule rule) =>
        new(
            rule.Id,
            rule.Title,
            rule.Kind,
            rule.Total,
            rule.Share,
            rule.CategoryId,
            rule.AccountId,
            LedgerDates.Write(rule.Date),
            rule.Note,
            rule.Frequency,
            LedgerDates.Write(rule.NextDate),
            rule.AnchorDay,
            rule.Active
        );
}
