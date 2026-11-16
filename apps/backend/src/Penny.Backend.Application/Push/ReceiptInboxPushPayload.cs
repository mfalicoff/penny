using System.Text.Json;

namespace Penny.Backend.Application.Push;

// The personal deep link of `receipt.received` (MAZ-184): exactly
// `{inboxItemId, eventId}`, which the client opens in its receipt inbox. It carries no
// household, sender, subject or amount.
public sealed record ReceiptInboxPushPayload(string InboxItemId, string EventId)
    : PushPayload(EventId)
{
    public const string InboxItemKey = "inboxItemId";
    public const string Thread = "receipt-inbox";

    public override string ThreadId => Thread;

    // Exactly the two keys: any other key (a household key in particular) is invalid.
    internal static ReceiptInboxPushPayload? Read(JsonElement root)
    {
        foreach (var property in root.EnumerateObject())
            if (property.Name is not (InboxItemKey or "eventId"))
                return null;
        var item = Text(root, InboxItemKey);
        var eventId = Text(root, "eventId");
        if (item is null || !Id().IsMatch(item) || eventId is null || !IsEventId(eventId))
            return null;
        return new(item, eventId);
    }

    public override IReadOnlyDictionary<string, string> ToDictionary() =>
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [InboxItemKey] = InboxItemId,
            ["eventId"] = EventId,
        };
}
