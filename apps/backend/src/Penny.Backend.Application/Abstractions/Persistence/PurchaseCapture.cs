namespace Penny.Backend.Application.Abstractions.Persistence;

// A validated capture from a device. `IdempotencyKey` is the device's own id for the tap,
// so a retried upload finds the item it already made.
public sealed record PurchaseCapture(
    string IdempotencyKey,
    string Merchant,
    long Amount,
    string Currency,
    string? Card,
    DateTimeOffset CapturedAt
);
