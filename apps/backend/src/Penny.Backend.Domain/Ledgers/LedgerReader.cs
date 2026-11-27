using System.Text.Json;

namespace Penny.Backend.Domain.Ledgers;

// Validates a `PUT /api/ledger` body (`{revision, ledger}`) with the v4 ledger rules
// shared with the iOS and web clients:
// - The ledger must be version 4 and carry every collection, `accounts` and `trips`
//   included. Any other version is invalid.
// - Numbers follow JavaScript: any JSON number that is a safe integer is accepted
//   (`1.0`, `1e2`); strings, booleans and null are not.
// - Optional fields may be absent but never JSON null. Unknown keys are ignored and
//   the last duplicate key wins, as with JSON.parse.
// - Account and trip names are trimmed with JavaScript whitespace rules; other
//   strings are kept verbatim. Lengths count UTF-16 code units.
// - Strings with NUL or unpaired surrogates are rejected (PostgreSQL text cannot hold
//   them), and the last safe revision cannot be written because its successor would
//   not be a safe integer.
// - Contract 2.4.0 (MAZ-151): a transaction paid in another currency carries
//   originalAmount, originalCurrency, rate and rateStatus together (plus rateDate unless
//   the rate is edited) and its total is the conversion (Currencies.ForeignAmountProblem);
//   recurring rules carry none of them.
public static class LedgerReader
{
    // Returns null for any invalid body: every problem is reported with one message.
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
        Integer(Required(ledger, "version"), LedgerDocument.Version, LedgerDocument.Version);
        var currency = Choice(Required(ledger, "currency"), LedgerLimits.Currencies);
        var accounts = List(Required(ledger, "accounts"), LedgerLimits.MaxAccounts, ReadAccount);
        var trips = List(Required(ledger, "trips"), LedgerLimits.MaxTrips, ReadTrip);
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
        // Recurring suggestions dismissed on any device (contract 2.3.0), in the order sent.
        var dismissedSuggestions = ledger.TryGetValue("dismissedSuggestions", out var dismissed)
            ? List(dismissed, LedgerLimits.MaxDismissedSuggestions, item =>
                Text(item, 1, LedgerLimits.DismissedSuggestionLength)
            )
            : [];

        // Cross-field rules: unique ids, ordered trip dates and consistent references.
        Unique(accounts.Select(account => account.Id));
        Unique(trips.Select(trip => trip.Id));
        Unique(categories.Select(category => category.Id));
        Unique(transactions.Select(entry => entry.Id));
        Unique(recurring.Select(rule => rule.Id));
        Unique(dismissedSuggestions);
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
        // Only expenses are split between people (contract 2.2.0).
        foreach (var entry in transactions)
            Require(entry.Participants is null || entry.Kind == "expense");
        foreach (var rule in recurring)
            Require(rule.Participants is null || rule.Kind == "expense");
        // An entry paid in another currency carries its amount, currency and rate together,
        // and its total is the conversion (contract 2.4.0). Rules stay in the home currency.
        foreach (var entry in transactions)
            Require(
                Currencies.ForeignAmountProblem(
                    entry.Total,
                    entry.Foreign?.OriginalAmount,
                    entry.Foreign?.OriginalCurrency,
                    entry.Foreign?.Rate,
                    entry.Foreign?.RateStatus,
                    entry.Foreign?.RateDate,
                    currency
                )
                    is null
            );
        foreach (var entry in transactions)
            Require(
                entry.TripId is null || (entry.Kind == "expense" && tripIds.Contains(entry.TripId))
            );

        // Its successor would exceed Number.MAX_SAFE_INTEGER (and the column bound).
        Require(revision < LedgerLimits.MaxSafeInteger);
        return new(
            revision,
            new(
                currency,
                accounts,
                trips,
                categories,
                transactions,
                recurring,
                dismissedSuggestions
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
            OptionalParticipants(fields),
            Id(Required(fields, "categoryId")),
            OptionalId(fields, "accountId"),
            OptionalId(fields, "tripId"),
            Date(Required(fields, "date")),
            Text(Required(fields, "note"), 0, 1000),
            receipt,
            OptionalId(fields, "recurringId"),
            ReadForeign(fields)
        );
    }

    private static RecurringRule ReadRecurring(JsonElement value)
    {
        var fields = Fields(value);
        // The entry schema parses tripId, then the refinement rejects it on rules.
        OptionalId(fields, "tripId");
        Require(!fields.ContainsKey("tripId"));
        // Rules stay in the home currency (MAZ-151 phase 1): any foreign-amount key, even
        // null, is refused rather than stripped.
        foreach (var name in ForeignFields)
            Require(!fields.ContainsKey(name));
        var active = Required(fields, "active");
        Require(active.ValueKind is JsonValueKind.True or JsonValueKind.False);
        return new(
            Id(Required(fields, "id")),
            Text(Required(fields, "title"), 1, 100),
            Choice(Required(fields, "kind"), LedgerLimits.Kinds),
            Integer(Required(fields, "total"), 1, LedgerLimits.MaxCents),
            Integer(Required(fields, "share"), 0, LedgerLimits.MaxCents),
            OptionalParticipants(fields),
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

    private static readonly string[] ForeignFields =
    [
        "originalAmount",
        "originalCurrency",
        "rate",
        "rateStatus",
        "rateDate",
    ];

    // The foreign-amount fields of a transaction (contract 2.4.0), each typed like the
    // ledger schema: a positive amount, a listed currency code, a canonical rate, a known
    // status and a calendar date. A partial set (or a rate date alone) is invalid; the
    // cross-field rules (currency, date by status, conversion) run with the ledger's
    // currency in ReadWrite.
    private static ForeignAmount? ReadForeign(Dictionary<string, JsonElement> fields)
    {
        long? amount = fields.TryGetValue("originalAmount", out var amountValue)
            ? Integer(amountValue, 1, LedgerLimits.MaxCents)
            : null;
        string? currency = null;
        if (fields.TryGetValue("originalCurrency", out var currencyValue))
        {
            currency = Text(currencyValue, 0, int.MaxValue);
            Require(Currencies.IsCurrency(currency));
        }
        string? rate = null;
        if (fields.TryGetValue("rate", out var rateValue))
        {
            rate = Text(rateValue, 0, int.MaxValue);
            Require(Currencies.ValidRate(rate));
        }
        string? status = fields.TryGetValue("rateStatus", out var statusValue)
            ? Choice(statusValue, Currencies.RateStatuses)
            : null;
        DateOnly? date = fields.TryGetValue("rateDate", out var dateValue) ? Date(dateValue) : null;
        if (amount is null && currency is null && rate is null && status is null)
        {
            Require(date is null);
            return null;
        }
        Require(
            amount is not null && currency is not null && rate is not null && status is not null
        );
        return new(amount!.Value, currency!, rate!, status!, date);
    }

    // How many people split an expense, the person included: an integer from 2 to 100.
    private static int? OptionalParticipants(Dictionary<string, JsonElement> fields) =>
        fields.TryGetValue("participants", out var value)
            ? (int)Integer(value, LedgerLimits.MinParticipants, LedgerLimits.MaxParticipants)
            : null;

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

    // A finite JSON number with an integral value no larger in magnitude than
    // Number.MAX_SAFE_INTEGER, within [min, max].
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
