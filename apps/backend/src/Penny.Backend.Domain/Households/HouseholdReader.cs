using System.Text.Json;
using System.Text.RegularExpressions;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Domain.Households;

// Ports of the legacy household zod schemas (server/infrastructure/households.ts),
// with the same JSON rules as LedgerReader: safe-integer numbers, optional fields may
// be absent but never null, unknown keys ignored, last duplicate key wins, names
// trimmed with JavaScript whitespace rules and measured in UTF-16 code units. Every
// reader returns null for an invalid body; the API reports one message for all.
public static partial class HouseholdReader
{
    public const int NameLength = 80;

    // `householdInput`, or `tripInput` when `trip` is set.
    public static NewHousehold? ReadNew(JsonElement? body, bool trip) =>
        Read(
            body,
            fields => new NewHousehold(
                Name(fields),
                LedgerReader.Choice(
                    LedgerReader.Required(fields, "currency"),
                    LedgerLimits.Currencies
                ),
                Offset(fields),
                trip ? Dates(fields) : null
            )
        );

    // `{name}` for PATCH /api/households/{id}.
    public static string? ReadName(JsonElement? body) => Read(body, Name);

    // `tripFields` without currency and offset; the end is on or after the start.
    public static TripChange? ReadTrip(JsonElement? body) =>
        Read(body, fields => new TripChange(Name(fields), Dates(fields)));

    // `{code: /^[A-Fa-f0-9]{10}$/, timezoneOffsetMinutes?}`.
    public static JoinRequest? ReadJoin(JsonElement? body) =>
        Read(
            body,
            fields =>
            {
                var code = LedgerReader.Text(LedgerReader.Required(fields, "code"), 10, 10);
                LedgerReader.Require(CodeFormat().IsMatch(code));
                return new JoinRequest(code.ToUpperInvariant(), Offset(fields));
            }
        );

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

    // zod `.trim().min(1).max(80)`: trimmed first, then measured.
    private static string Name(Dictionary<string, JsonElement> fields)
    {
        var name = LedgerText.TrimLikeJavaScript(
            LedgerReader.Text(LedgerReader.Required(fields, "name"), 0, int.MaxValue)
        );
        LedgerReader.Require(name.Length is >= 1 and <= NameLength);
        return name;
    }

    private static int? Offset(Dictionary<string, JsonElement> fields) =>
        fields.TryGetValue("timezoneOffsetMinutes", out var value)
            ? (int)
                LedgerReader.Integer(
                    value,
                    MembershipDates.MinOffsetMinutes,
                    MembershipDates.MaxOffsetMinutes
                )
            : null;

    private static TripDates Dates(Dictionary<string, JsonElement> fields)
    {
        var start = LedgerReader.Date(LedgerReader.Required(fields, "startDate"));
        var end = LedgerReader.Date(LedgerReader.Required(fields, "endDate"));
        LedgerReader.Require(end >= start);
        return new(start, end);
    }

    [GeneratedRegex("^[A-Fa-f0-9]{10}\\z", RegexOptions.CultureInvariant)]
    private static partial Regex CodeFormat();
}
