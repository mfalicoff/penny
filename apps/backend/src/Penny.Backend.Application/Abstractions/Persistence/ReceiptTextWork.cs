namespace Penny.Backend.Application.Abstractions.Persistence;

// A claimed receipt text row (MAZ-125): the receipt, its stored type and size, how
// many attempts were made including this one (the claim counts it) and when it became
// due (for the worker lag metric).
public sealed record ReceiptTextWork(
    string ReceiptId,
    string Mime,
    long SizeBytes,
    int Attempts,
    DateTimeOffset DueAt
);
