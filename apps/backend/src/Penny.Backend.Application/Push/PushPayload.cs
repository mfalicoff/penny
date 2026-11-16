using System.Text.Json;
using System.Text.RegularExpressions;

namespace Penny.Backend.Application.Push;

// The deep-link payload stored in `push_outbox.payload` and delivered to clients
// unchanged as top-level custom keys. It is exactly one of two shapes: a household
// link (`HouseholdPushPayload`, the allowlisted
// `/households/{householdId}?month=…&expenseId=…` route) or a personal receipt inbox
// link (`ReceiptInboxPushPayload`, MAZ-184). A stored object mixing the two is invalid.
public abstract partial record PushPayload(string EventId)
{
    // The APNs `thread-id` that groups related notifications.
    public abstract string ThreadId { get; }

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
            return root.TryGetProperty(ReceiptInboxPushPayload.InboxItemKey, out _)
                ? ReceiptInboxPushPayload.Read(root)
                : HouseholdPushPayload.Read(root);
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException)
        {
            return null;
        }
    }

    // The custom keys every transport sends, in contract order.
    public abstract IReadOnlyDictionary<string, string> ToDictionary();

    // The payload as stored in `push_outbox.payload`.
    public string ToJson() => JsonSerializer.Serialize(ToDictionary());

    private protected static string? Text(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private protected static bool IsEventId(string? eventId) =>
        eventId is { Length: >= 1 and <= 100 };

    [GeneratedRegex("^[A-Za-z0-9_-]{1,100}$")]
    private protected static partial Regex Id();
}
