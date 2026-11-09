using System.Text.Json;

namespace Penny.Backend.Domain.Ledgers;

// Port of the legacy `ledgerWriteSchema` (server/validation/ledger.ts, zod 4) and
// its transform. Semantics kept on purpose:
// - Numbers follow JavaScript: any JSON number that is a safe integer is accepted
//   (`1.0`, `1e2`); strings, booleans and null are not.
// - Optional fields may be absent but never JSON null. Unknown keys are ignored and
//   the last duplicate key wins, as with JSON.parse.
// - Account and trip names are trimmed with JavaScript whitespace rules; other
//   strings are kept verbatim. Lengths count UTF-16 code units.
// - v1-v3 documents are upgraded to v4 with the client's `upgradeLedger` rule.
// Deliberate additions for PostgreSQL storage: strings with NUL or unpaired
// surrogates are rejected, and the last safe revision cannot be written because its
// successor would not be a safe integer.
public static class LedgerReader
{
    // Returns null for any invalid body: the legacy API reported one message for all.
    public static LedgerWrite? Read(JsonElement body)
    {
        try
        {
            return ReadWrite(body);
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static LedgerWrite ReadWrite(JsonElement body)
    {
        var root = Fields(body);
        var revision = Integer(Required(root, "revision"), 0, LedgerLimits.MaxSafeInteger);
        var ledger = Fields(Required(root, "ledger"));
        var version = (int)Integer(Required(ledger, "version"), 1, LedgerDocument.Version);
        var currency = Choice(Required(ledger, "currency"), LedgerLimits.Currencies);
        var accounts = ledger.TryGetValue("accounts", out var accountItems)
            ? List(accountItems, LedgerLimits.MaxAccounts, ReadAccount)
            : null;
        var trips = ledger.TryGetValue("trips", out var tripItems)
            ? List(tripItems, LedgerLimits.MaxTrips, ReadTrip)
            : null;
        var categories = List(
            Required(ledger, "categories"),
            LedgerLimits.MaxCategories,
            ReadCategory
        );
        var transactions = List(
            Required(ledger, "transactions"),
            LedgerLimits.MaxTransactions,
            ReadTransaction
        );
        var recurring = List(
            Required(ledger, "recurring"),
            LedgerLimits.MaxRecurring,
            ReadRecurring
        );

        // The legacy superRefine rules.
        Require(version < 3 || accounts is not null);
        Require(version != LedgerDocument.Version || trips is not null);
        var omittedTrips = trips is null;
        accounts ??= [];
        trips ??= [];
        Unique(accounts.Select(account => account.Id));
        Unique(trips.Select(trip => trip.Id));
        Unique(categories.Select(category => category.Id));
        Unique(transactions.Select(entry => entry.Id));
        Unique(recurring.Select(rule => rule.Id));
        foreach (var trip in trips)
            Require(trip.EndDate >= trip.StartDate);
        var accountIds = accounts.Select(account => account.Id).ToHashSet(StringComparer.Ordinal);
        var tripIds = trips.Select(trip => trip.Id).ToHashSet(StringComparer.Ordinal);
        // Like a JavaScript Map built from the list, the last duplicate wins.
        var categoryKinds = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var category in categories)
            categoryKinds[category.Id] = category.Kind;
        foreach (
            var (kind, total, share, categoryId, accountId) in transactions
                .Select(entry =>
                    (entry.Kind, entry.Total, entry.Share, entry.CategoryId, entry.AccountId)
                )
                .Concat(
                    recurring.Select(rule =>
                        (rule.Kind, rule.Total, rule.Share, rule.CategoryId, rule.AccountId)
                    )
                )
        )
        {
            Require(accountId is null || accountIds.Contains(accountId));
            Require(share <= total && (kind == "expense" || share == total));
            Require(
                categoryKinds.TryGetValue(categoryId, out var categoryKind) && categoryKind == kind
            );
        }
        foreach (var entry in transactions)
            Require(
                entry.TripId is null || (entry.Kind == "expense" && tripIds.Contains(entry.TripId))
            );

        // Its successor would exceed Number.MAX_SAFE_INTEGER (and the column bound).
        Require(revision < LedgerLimits.MaxSafeInteger);
        return new(
            revision,
            version,
            omittedTrips,
            new(
                currency,
                accounts,
                trips,
                LedgerUpgrade.Categories(version, categories),
                transactions,
                recurring
            )
        );
    }

    private static PaymentAccount ReadAccount(JsonElement value)
    {
        var fields = Fields(value);
        return new(
            Id(Required(fields, "id")),
            LedgerText.TrimLikeJavaScript(Text(Required(fields, "name"), 0, int.MaxValue))
                is { Length: >= 1 and <= 50 } name
                ? name
                : throw new FormatException(),
            Choice(Required(fields, "type"), LedgerLimits.AccountTypes)
        );
    }

    private static Trip ReadTrip(JsonElement value)
    {
        var fields = Fields(value);
        return new(
            Id(Required(fields, "id")),
            LedgerText.TrimLikeJavaScript(Text(Required(fields, "name"), 0, int.MaxValue))
                is { Length: >= 1 and <= 80 } name
                ? name
                : throw new FormatException(),
            Date(Required(fields, "startDate")),
            Date(Required(fields, "endDate")),
            OptionalId(fields, "sharedHouseholdId")
        );
    }

    private static Category ReadCategory(JsonElement value)
    {
        var fields = Fields(value);
        var color = Text(Required(fields, "color"), 7, 7);
        Require(
            color[0] == '#' && color.AsSpan(1).ContainsAnyExcept("0123456789abcdefABCDEF") == false
        );
        return new(
            Id(Required(fields, "id")),
            Text(Required(fields, "name"), 1, 50),
            Text(Required(fields, "icon"), 0, 80),
            color,
            Choice(Required(fields, "kind"), LedgerLimits.Kinds)
        );
    }

    private static Entry ReadTransaction(JsonElement value)
    {
        var fields = Fields(value);
        ReceiptLink? receipt = null;
        if (fields.TryGetValue("receipt", out var receiptValue))
        {
            var receiptFields = Fields(receiptValue);
            receipt = new(
                Id(Required(receiptFields, "id")),
                Text(Required(receiptFields, "name"), 0, 255),
                Text(Required(receiptFields, "mime"), 0, 100),
                Text(Required(receiptFields, "uri"), 0, 500)
            );
        }
        return new(
            Id(Required(fields, "id")),
            Text(Required(fields, "title"), 1, 100),
            Choice(Required(fields, "kind"), LedgerLimits.Kinds),
            Integer(Required(fields, "total"), 1, LedgerLimits.MaxCents),
            Integer(Required(fields, "share"), 0, LedgerLimits.MaxCents),
            Id(Required(fields, "categoryId")),
            OptionalId(fields, "accountId"),
            OptionalId(fields, "tripId"),
            Date(Required(fields, "date")),
            Text(Required(fields, "note"), 0, 1000),
            receipt,
            OptionalId(fields, "recurringId")
        );
    }

    private static RecurringRule ReadRecurring(JsonElement value)
    {
        var fields = Fields(value);
        // The entry schema parses tripId, then the refinement rejects it on rules.
        OptionalId(fields, "tripId");
        Require(!fields.ContainsKey("tripId"));
        var active = Required(fields, "active");
        Require(active.ValueKind is JsonValueKind.True or JsonValueKind.False);
        return new(
            Id(Required(fields, "id")),
            Text(Required(fields, "title"), 1, 100),
            Choice(Required(fields, "kind"), LedgerLimits.Kinds),
            Integer(Required(fields, "total"), 1, LedgerLimits.MaxCents),
            Integer(Required(fields, "share"), 0, LedgerLimits.MaxCents),
            Id(Required(fields, "categoryId")),
            OptionalId(fields, "accountId"),
            Date(Required(fields, "date")),
            Text(Required(fields, "note"), 0, 1000),
            Choice(Required(fields, "frequency"), LedgerLimits.Frequencies),
            Date(Required(fields, "nextDate")),
            (int)Integer(Required(fields, "anchorDay"), 1, 31),
            active.ValueKind == JsonValueKind.True
        );
    }

    // The JSON helpers below are internal so HouseholdReader applies identical rules.
    internal static Dictionary<string, JsonElement> Fields(JsonElement value)
    {
        Require(value.ValueKind == JsonValueKind.Object);
        var fields = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
            fields[property.Name] = property.Value;
        return fields;
    }

    internal static JsonElement Required(Dictionary<string, JsonElement> fields, string name) =>
        fields.TryGetValue(name, out var value) ? value : throw new FormatException();

    private static List<T> List<T>(JsonElement value, int max, Func<JsonElement, T> read)
    {
        Require(value.ValueKind == JsonValueKind.Array && value.GetArrayLength() <= max);
        var items = new List<T>(value.GetArrayLength());
        foreach (var item in value.EnumerateArray())
            items.Add(read(item));
        return items;
    }

    internal static string Text(JsonElement value, int min, int max)
    {
        Require(value.ValueKind == JsonValueKind.String);
        string text;
        try
        {
            text = value.GetString()!;
        }
        catch (InvalidOperationException)
        {
            throw new FormatException();
        }
        Require(text.Length >= min && text.Length <= max && LedgerText.IsStorable(text));
        return text;
    }

    private static string Id(JsonElement value) => Text(value, 1, LedgerLimits.IdLength);

    private static string? OptionalId(Dictionary<string, JsonElement> fields, string name) =>
        fields.TryGetValue(name, out var value) ? Id(value) : null;

    internal static string Choice(JsonElement value, IReadOnlyList<string> choices)
    {
        var text = Text(value, 1, LedgerLimits.IdLength);
        Require(choices.Contains(text, StringComparer.Ordinal));
        return text;
    }

    internal static DateOnly Date(JsonElement value) =>
        LedgerDates.TryParse(Text(value, 10, 10), out var date)
            ? date
            : throw new FormatException();

    // zod 4 `z.number().int()`: a finite JavaScript number that is a safe integer.
    internal static long Integer(JsonElement value, long min, long max)
    {
        Require(
            value.ValueKind == JsonValueKind.Number
                && value.TryGetDouble(out var number)
                && double.IsFinite(number)
                && Math.Floor(number) == number
                && Math.Abs(number) <= LedgerLimits.MaxSafeInteger
                && number >= min
                && number <= max
        );
        return (long)value.GetDouble();
    }

    private static void Unique(IEnumerable<string> ids)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var id in ids)
            Require(seen.Add(id));
    }

    internal static void Require(bool valid)
    {
        if (!valid)
            throw new FormatException();
    }
}
