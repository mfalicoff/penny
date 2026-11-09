namespace Penny.Backend.Application.Push;

// An accepted Expo ticket leased for a receipt check.
public sealed record PushReceiptClaim(
    string OutboxId,
    string Token,
    string TicketId,
    DateTimeOffset SentAt,
    int Attempts
);
