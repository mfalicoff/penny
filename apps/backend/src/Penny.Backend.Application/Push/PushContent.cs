namespace Penny.Backend.Application.Push;

// Notification text per household event. The text never names
// people, amounts or titles, so lock screens reveal no financial details.
public static class PushContent
{
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
            _ => null,
        };
}
