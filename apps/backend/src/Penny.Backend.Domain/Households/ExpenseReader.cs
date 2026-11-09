using System.Text.Json;
using System.Text.RegularExpressions;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Domain.Households;

// Ports of the legacy shared-expense zod schemas (server/infrastructure/households.ts)
// with the JSON rules of LedgerReader and HouseholdReader: safe-integer numbers,
// optional fields may be absent but never null, unknown keys ignored, last duplicate
// key wins, trimmed strings measured in UTF-16 code units, storable text only. Every
// reader returns null for an invalid body; the API reports one message for all.
public static partial class ExpenseReader
{
    public const int TitleLength = 100;
    public const int CategoryNameLength = 50;
    public const int CategoryIconLength = 80;
    public const int NoteLength = 1000;
    public const int MaxAllocations = 100;

    // `expenseInput` for POST /api/households/{id}/expenses.
    public static ExpenseInput? ReadInput(JsonElement? body) => Read(body, Input);

    // `expenseInput.extend({revision, targetHouseholdId?})` for PUT.
    public static ExpenseUpdate? ReadUpdate(JsonElement? body) =>
        Read(
            body,
            fields => new ExpenseUpdate(
                Input(fields),
                Revision(fields),
                fields.TryGetValue("targetHouseholdId", out var target)
                    ? LedgerReader.Text(target, 1, LedgerLimits.IdLength)
                    : null
            )
        );

    // Shared `recurringInput` (`expenseInput` without `date`, plus `nextDate` and
    // `frequency`) for POST /api/households/{id}/recurring.
    public static RecurringInput? ReadRecurring(JsonElement? body) => Read(body, Recurring);

    // `recurringInput.extend({revision, active})` for PUT .../recurring/{ruleId}.
    public static RecurringUpdate? ReadRecurringUpdate(JsonElement? body) =>
        Read(
            body,
            fields =>
            {
                var active = LedgerReader.Required(fields, "active");
                LedgerReader.Require(active.ValueKind is JsonValueKind.True or JsonValueKind.False);
                return new RecurringUpdate(
                    Recurring(fields),
                    active.ValueKind == JsonValueKind.True,
                    Revision(fields)
                );
            }
        );

    // `{revision}` for DELETE; null when invalid.
    public static long? ReadRevision(JsonElement? body)
    {
        if (body is not { } value)
            return null;
        try
        {
            return Revision(LedgerReader.Fields(value));
        }
        catch (FormatException)
        {
            return null;
        }
    }

    // `{fromUserId, revision}` for POST .../payments.
    public static PaymentRequest? ReadPayment(JsonElement? body) =>
        Read(
            body,
            fields => new PaymentRequest(
                LedgerReader.Text(
                    LedgerReader.Required(fields, "fromUserId"),
                    1,
                    LedgerLimits.IdLength
                ),
                Revision(fields)
            )
        );

    // The `month` query: /^\d{4}-(0[1-9]|1[0-2])$/ with ASCII digits.
    public static bool IsMonth(string value) => MonthFormat().IsMatch(value);

    // The projection `year` query: /^\d{4}$/.
    public static bool IsYear(string value) => YearFormat().IsMatch(value);

    private static T? Read<T>(JsonElement? body, Func<Dictionary<string, JsonElement>, T> read)
        where T : class
    {
        if (body is not { } value)
            return null;
        try
        {
            return read(LedgerReader.Fields(value));
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static ExpenseInput Input(Dictionary<string, JsonElement> fields) =>
        Input(fields, "date");

    private static RecurringInput Recurring(Dictionary<string, JsonElement> fields) =>
        new(
            Input(fields, "nextDate"),
            LedgerReader.Choice(
                LedgerReader.Required(fields, "frequency"),
                LedgerLimits.Frequencies
            )
        );

    // The expense fields, with the calendar date read from `dateField`.
    private static ExpenseInput Input(Dictionary<string, JsonElement> fields, string dateField) =>
        new(
            Trimmed(LedgerReader.Required(fields, "title"), TitleLength),
            LedgerReader.Integer(
                LedgerReader.Required(fields, "totalCents"),
                1,
                LedgerLimits.MaxCents
            ),
            LedgerReader.Date(LedgerReader.Required(fields, dateField)),
            Id(LedgerReader.Required(fields, "payerUserId")),
            LedgerReader.Choice(LedgerReader.Required(fields, "splitMode"), ExpenseSplit.Modes),
            fields.TryGetValue("allocations", out var allocations)
                ? Allocations(allocations)
                : null,
            Category(LedgerReader.Required(fields, "category")),
            fields.TryGetValue("note", out var note) ? LedgerReader.Text(note, 0, NoteLength) : "",
            fields.TryGetValue("accountId", out var account) ? Id(account) : null,
            fields.TryGetValue("receiptId", out var receipt) ? Id(receipt) : null,
            fields.TryGetValue("timezoneOffsetMinutes", out var offset)
                ? (int)
                    LedgerReader.Integer(
                        offset,
                        MembershipDates.MinOffsetMinutes,
                        MembershipDates.MaxOffsetMinutes
                    )
                : null
        );

    // A zod union: `{userId, amountCents}` is tried first, then
    // `{userId, percentBasisPoints}`; the matching branch drops the other key.
    private static List<SplitAllocation> Allocations(JsonElement value)
    {
        LedgerReader.Require(
            value.ValueKind == JsonValueKind.Array && value.GetArrayLength() <= MaxAllocations
        );
        var items = new List<SplitAllocation>(value.GetArrayLength());
        foreach (var item in value.EnumerateArray())
        {
            var fields = LedgerReader.Fields(item);
            var userId = Id(LedgerReader.Required(fields, "userId"));
            if (
                fields.TryGetValue("amountCents", out var amount)
                && Optional(() => LedgerReader.Integer(amount, 0, LedgerLimits.MaxSafeInteger))
                    is { } cents
            )
                items.Add(new(userId, cents, null));
            else if (
                fields.TryGetValue("percentBasisPoints", out var percent)
                && Optional(() => LedgerReader.Integer(percent, 0, HouseholdSplits.PercentWhole))
                    is { } points
            )
                items.Add(new(userId, null, points));
            else
                throw new FormatException();
        }
        return items;
    }

    private static ExpenseCategory Category(JsonElement value)
    {
        var fields = LedgerReader.Fields(value);
        var name = Trimmed(LedgerReader.Required(fields, "name"), CategoryNameLength);
        var icon = LedgerReader.Text(LedgerReader.Required(fields, "icon"), 0, CategoryIconLength);
        var color = LedgerReader.Text(LedgerReader.Required(fields, "color"), 7, 7);
        LedgerReader.Require(ColorFormat().IsMatch(color));
        return new(name, icon, color);
    }

    // `z.number().int().nonnegative()`: any safe integer from zero.
    private static long Revision(Dictionary<string, JsonElement> fields) =>
        LedgerReader.Integer(
            LedgerReader.Required(fields, "revision"),
            0,
            LedgerLimits.MaxSafeInteger
        );

    private static string Id(JsonElement value) =>
        LedgerReader.Text(value, 1, LedgerLimits.IdLength);

    // zod `.trim().min(1).max(n)`: trimmed first, then measured.
    private static string Trimmed(JsonElement value, int max)
    {
        var text = LedgerText.TrimLikeJavaScript(LedgerReader.Text(value, 0, int.MaxValue));
        LedgerReader.Require(text.Length >= 1 && text.Length <= max);
        return text;
    }

    private static long? Optional(Func<long> read)
    {
        try
        {
            return read();
        }
        catch (FormatException)
        {
            return null;
        }
    }

    [GeneratedRegex("^#[0-9a-fA-F]{6}\\z", RegexOptions.CultureInvariant)]
    private static partial Regex ColorFormat();

    [GeneratedRegex("^[0-9]{4}-(0[1-9]|1[0-2])\\z", RegexOptions.CultureInvariant)]
    private static partial Regex MonthFormat();

    [GeneratedRegex("^[0-9]{4}\\z", RegexOptions.CultureInvariant)]
    private static partial Regex YearFormat();
}
