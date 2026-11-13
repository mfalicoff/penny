using System.Text.Json;
using System.Text.RegularExpressions;

namespace Penny.Backend.Application.Push;

// The household deep-link payload stored in `push_outbox.payload` and delivered to
// clients unchanged: the client navigates only to the
// allowlisted `/households/{householdId}?month=…&expenseId=…` route.
public sealed partial record PushPayload(
    string HouseholdId,
    string Month,
    string? ExpenseId,
    string EventId
)
{
    // Null when the stored JSON is not a valid payload (the delivery then fails
    // permanently).
    public static PushPayload? Parse(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
                return null;
            var household = Text(root, "householdId");
            var month = Text(root, "month");
            var eventId = Text(root, "eventId");
            string? expense = null;
            if (root.TryGetProperty("expenseId", out var expenseValue))
            {
                expense =
                    expenseValue.ValueKind == JsonValueKind.String
                        ? expenseValue.GetString()
                        : null;
                if (expense is null || !Id().IsMatch(expense))
                    return null;
            }
            if (
                household is null
                || !Id().IsMatch(household)
                || month is null
                || !MonthPattern().IsMatch(month)
                || eventId is null
                || eventId.Length is < 1 or > 100
            )
                return null;
            return new(household, month, expense, eventId);
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException)
        {
            return null;
        }
    }

    // The custom keys every transport sends, in contract order.
    public IReadOnlyDictionary<string, string> ToDictionary()
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

    private static string? Text(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    [GeneratedRegex("^[A-Za-z0-9_-]{1,100}$")]
    private static partial Regex Id();

    [GeneratedRegex("^[0-9]{4}-(0[1-9]|1[0-2])$")]
    private static partial Regex MonthPattern();
}
