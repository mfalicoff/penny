using System.Globalization;
using System.Text.Json;

namespace Penny.Backend.Persistence.Import;

// Storage validation only: retain the original v1-v4 document and optional fields.
// MAZ-55 owns upgrades and public write validation.
internal static class LedgerImportValidator
{
    public static void Validate(JsonElement ledger)
    {
        Require(ledger.ValueKind == JsonValueKind.Object);
        var version = ledger.GetProperty("version").GetInt32();
        Require(version is >= 1 and <= 4);
        Choice(ledger, "currency", "CAD", "USD", "EUR", "GBP");
        var categories = List(ledger, "categories", 300);
        var accounts = List(ledger, "accounts", 300, version < 3);
        var trips = List(ledger, "trips", 300, version < 4);
        var transactions = List(ledger, "transactions", 100000);
        var recurring = List(ledger, "recurring", 1000);
        foreach (var category in categories.Values)
        {
            Text(category, "name", 1, 50);
            Text(category, "icon", 0, 80);
            Choice(category, "kind", "expense", "income", "investment");
            var color = Text(category, "color", 7, 7);
            Require(
                color[0] == '#'
                    && color.AsSpan(1).ContainsAnyExcept("0123456789abcdefABCDEF") == false
            );
        }
        foreach (var account in accounts.Values)
        {
            Text(account, "name", 1, 50);
            Choice(account, "type", "bank", "credit", "cash", "other");
        }
        foreach (var trip in trips.Values)
        {
            Text(trip, "name", 1, 80);
            Require(Date(trip, "startDate") <= Date(trip, "endDate"));
            if (trip.TryGetProperty("sharedHouseholdId", out _))
                Text(trip, "sharedHouseholdId", 1, 100);
        }
        foreach (var entry in transactions.Values.Concat(recurring.Values))
        {
            Text(entry, "title", 1, 100);
            Text(entry, "note", 0, 1000);
            Date(entry, "date");
            var kind = Choice(entry, "kind", "expense", "income", "investment");
            var total = Money(entry, "total");
            var share = Money(entry, "share");
            Require(total > 0 && share <= total && (kind == "expense" || share == total));
            Require(
                categories.TryGetValue(Text(entry, "categoryId", 1, 100), out var category)
                    && category.GetProperty("kind").GetString() == kind
            );
            if (entry.TryGetProperty("accountId", out _))
                Require(accounts.ContainsKey(Text(entry, "accountId", 1, 100)));
        }
        foreach (var entry in transactions.Values)
        {
            if (entry.TryGetProperty("tripId", out _))
                Require(
                    entry.GetProperty("kind").GetString() == "expense"
                        && trips.ContainsKey(Text(entry, "tripId", 1, 100))
                );
            if (entry.TryGetProperty("recurringId", out _))
                Text(entry, "recurringId", 1, 100);
            if (entry.TryGetProperty("receipt", out var receipt))
            {
                Text(receipt, "id", 1, 100);
                Text(receipt, "name", 0, 255);
                Text(receipt, "mime", 0, 100);
                Text(receipt, "uri", 0, 500);
            }
        }
        foreach (var rule in recurring.Values)
        {
            Require(!rule.TryGetProperty("tripId", out _));
            Choice(rule, "frequency", "weekly", "monthly", "yearly");
            Date(rule, "nextDate");
            Require(rule.GetProperty("anchorDay").GetInt32() is >= 1 and <= 31);
            Require(
                rule.GetProperty("active").ValueKind is JsonValueKind.True or JsonValueKind.False
            );
        }
    }

    private static Dictionary<string, JsonElement> List(
        JsonElement value,
        string name,
        int max,
        bool optional = false
    )
    {
        if (optional && !value.TryGetProperty(name, out _))
            return new(StringComparer.Ordinal);
        var array = value.GetProperty(name);
        Require(array.ValueKind == JsonValueKind.Array && array.GetArrayLength() <= max);
        var items = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var item in array.EnumerateArray())
            Require(items.TryAdd(Text(item, "id", 1, 100), item));
        return items;
    }

    private static string Text(JsonElement value, string name, int min, int max)
    {
        var text = value.GetProperty(name).GetString();
        Require(text is not null && text.Length >= min && text.Length <= max);
        return text!;
    }

    private static string Choice(JsonElement value, string name, params string[] choices)
    {
        var text = Text(value, name, 1, 100);
        Require(choices.Contains(text, StringComparer.Ordinal));
        return text;
    }

    private static DateOnly Date(JsonElement value, string name)
    {
        Require(
            DateOnly.TryParseExact(
                Text(value, name, 10, 10),
                "yyyy-MM-dd",
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var date
            ) && date.Year is >= 2000 and <= 2100
        );
        return date;
    }

    private static long Money(JsonElement value, string name)
    {
        Require(
            value.GetProperty(name).TryGetInt64(out var amount) && amount is >= 0 and <= 99999999999
        );
        return amount;
    }

    private static void Require(bool valid)
    {
        if (!valid)
            throw new ImportFailure("invalid-ledger");
    }
}
