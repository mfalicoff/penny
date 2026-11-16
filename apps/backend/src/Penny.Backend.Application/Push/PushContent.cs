namespace Penny.Backend.Application.Push;

// Notification text per event. The text never names people, senders, subjects,
// amounts or titles, so lock screens reveal no financial details.
public static class PushContent
{
    // The personal "new receipt" event (MAZ-184): an emailed receipt reached the inbox.
    public const string ReceiptReceived = "receipt.received";

    public static (string Title, string Body)? For(string eventType) =>
        eventType switch
        {
            "expense.created" => (
                "New household expense",
                "A member added an expense. Open Penny to see your share."
            ),
            "expense.updated" => (
                "Household expense updated",
                "A shared expense changed. Open Penny to review it."
            ),
            "reimbursement.created" => (
                "Reimbursement recorded",
                "A household reimbursement was recorded."
            ),
            ReceiptReceived => ("New receipt", "An emailed receipt is ready to attach."),
            _ => null,
        };

    // Receipt events carry the receipt inbox link and household events the household
    // link; any other pairing is an invalid stored payload.
    public static bool Fits(string eventType, PushPayload payload) =>
        payload is ReceiptInboxPushPayload == (eventType == ReceiptReceived);
}
