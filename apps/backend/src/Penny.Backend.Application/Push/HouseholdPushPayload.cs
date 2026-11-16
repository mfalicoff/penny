using System.Text.Json;
using System.Text.RegularExpressions;

namespace Penny.Backend.Application.Push;

// The household deep link of `expense.created`, `expense.updated` and
// `reimbursement.created`: the client navigates only to the allowlisted
// `/households/{householdId}?month=…&expenseId=…` route.
public sealed partial record HouseholdPushPayload(
    string HouseholdId,
    string Month,
    string? ExpenseId,
    string EventId
) : PushPayload(EventId)
{
    public override string ThreadId => $"household-{HouseholdId}";

    internal static HouseholdPushPayload? Read(JsonElement root)
    {
        var household = Text(root, "householdId");
        var month = Text(root, "month");
        var eventId = Text(root, "eventId");
        string? expense = null;
        if (root.TryGetProperty("expenseId", out var expenseValue))
        {
            expense =
                expenseValue.ValueKind == JsonValueKind.String ? expenseValue.GetString() : null;
            if (expense is null || !Id().IsMatch(expense))
                return null;
        }
        if (
            household is null
            || !Id().IsMatch(household)
            || month is null
            || !MonthPattern().IsMatch(month)
            || eventId is null
            || !IsEventId(eventId)
        )
            return null;
        return new(household, month, expense, eventId);
    }

    public override IReadOnlyDictionary<string, string> ToDictionary()
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["householdId"] = HouseholdId,
            ["month"] = Month,
        };
        if (ExpenseId is not null)
            values["expenseId"] = ExpenseId;
        values["eventId"] = EventId;
        return values;
    }

    [GeneratedRegex("^[0-9]{4}-(0[1-9]|1[0-2])$")]
    private static partial Regex MonthPattern();
}
